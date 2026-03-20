// api/projects.js
import { db } from "../utils/firebase.js";
import { verifyToken } from "./auth.js";
import crypto from 'crypto';

const DEFAULT_IMAGE = 'https://picsum.photos/200/200';
const BASE_URL = process.env.BASE_URL;

// Helper functions
const generateProjectId = () => {
  return `proj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
};

const cleanProjectName = (name) => {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
};

const sanitizeHTML = (html) => {
  if (!html) return null;
  // Remove script tags and their contents
  let sanitized = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  // Remove on* attributes
  sanitized = sanitized.replace(/\s+on\w+="[^"]*"/gi, '');
  sanitized = sanitized.replace(/\s+on\w+='[^']*'/gi, '');
  // Remove javascript: links
  sanitized = sanitized.replace(/javascript:/gi, 'blocked:');
  return sanitized;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, user_id, project_slug } = req.query;

  try {
    // Public hosted project endpoint
    if (req.method === 'GET' && user_id && project_slug) {
      return await handleGetHostedProject(req, res, user_id, project_slug);
    }

    // Public projects list endpoint
    if (req.method === 'GET' && action === 'public' && req.query.user_tag) {
      return await handleListPublicProjects(req, res);
    }

    switch (action) {
      case 'create':
        return await handleCreateProject(req, res);
      case 'list':
        return await handleListUserProjects(req, res);
      case 'edit':
        return await handleEditProject(req, res);
      case 'delete':
        return await handleDeleteProject(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Projects API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleCreateProject(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { 
    name, 
    logo, 
    description, 
    image, 
    type, 
    visibility, 
    analytics,
    content
  } = req.body;

  if (!name || !image || !type || !visibility) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const validTypes = ['image', 'link', 'hosted'];
  const validVisibilities = ['public', 'private', 'test'];

  if (!validTypes.includes(type) || !validVisibilities.includes(visibility)) {
    return res.status(400).json({ error: 'Invalid type or visibility' });
  }

  const projectId = generateProjectId();
  const projectSlug = cleanProjectName(name);

  // Check if slug exists for this user
  const projectRef = db.ref(`ExProjects/users/${payload.userId}/${projectSlug}`);
  const snapshot = await projectRef.once('value');
  if (snapshot.exists()) {
    return res.status(400).json({ error: 'Project with this name already exists' });
  }

  const project = {
    projectId,
    user_id: payload.userId,
    user_tag: payload.userTag,
    name,
    slug: projectSlug,
    logo: logo || DEFAULT_IMAGE,
    description: description || '',
    image,
    type,
    visibility,
    analytics_enabled: analytics === 'true' || analytics === true,
    content: type === 'hosted' ? sanitizeHTML(content) : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    hosted_url: type === 'hosted' ? `${BASE_URL}/${payload.userId}/${projectSlug}` : null
  };

  // Store project
  await projectRef.set(project);
  
  // Add to user's projects list
  await db.ref(`ExProjects/user_index/${payload.userId}/${projectSlug}`).set(true);
  
  // If analytics is enabled, create analytics session
  if (project.analytics_enabled) {
    try {
      const analyticsSession = {
        project_id: projectId,
        project_name: name,
        user_id: payload.userId,
        user_tag: payload.userTag,
        created_at: new Date().toISOString(),
        tracking_url: `${BASE_URL}/api/analytics?action=track&project_id=${projectId}`
      };
      await db.ref(`ExAnalytics/projects/${projectId}`).set(analyticsSession);
      await db.ref(`ExAnalytics/user_projects/${payload.userId}/${projectId}`).set(true);
    } catch (error) {
      console.error('Failed to create analytics session:', error);
    }
  }

  return res.status(201).json({
    message: 'Project created successfully',
    project: {
      ...project,
      content: undefined
    },
    publish_url: type === 'hosted' ? project.hosted_url : null
  });
}

async function handleListPublicProjects(req, res) {
  const { user_tag } = req.query;

  if (!user_tag) {
    return res.status(400).json({ error: 'User tag required' });
  }

  // Get userId from user_tag
  const userIdRef = db.ref(`ExAuths/usertags/${user_tag}`);
  const userIdSnapshot = await userIdRef.once('value');
  const userId = userIdSnapshot.val();
  
  if (!userId) {
    return res.status(404).json({ error: 'User not found' });
  }

  const projectsRef = db.ref(`ExProjects/users/${userId}`);
  const projectsSnapshot = await projectsRef.once('value');
  const allProjects = projectsSnapshot.val() || {};
  
  const projects = [];

  for (const [slug, project] of Object.entries(allProjects)) {
    if (project.visibility === 'public') {
      projects.push({
        projectId: project.projectId,
        name: project.name,
        slug: project.slug,
        description: project.description,
        logo: project.logo,
        image: project.image,
        type: project.type,
        created_at: project.created_at,
        hosted_url: project.hosted_url
      });
    }
  }

  return res.json({ projects });
}

async function handleListUserProjects(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const projectsRef = db.ref(`ExProjects/users/${payload.userId}`);
  const projectsSnapshot = await projectsRef.once('value');
  const projects = projectsSnapshot.val() || {};
  
  const sanitizedProjects = Object.values(projects).map(project => ({
    ...project,
    content: project.type === 'hosted' ? '(content hidden)' : undefined
  }));
  
  return res.json({ projects: sanitizedProjects });
}

async function handleEditProject(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { project_slug, field, value } = req.body;

  if (!project_slug || !field || value === undefined) {
    return res.status(400).json({ error: 'Project slug, field, and value are required' });
  }

  const allowedFields = ['name', 'logo', 'description', 'image', 'type', 'visibility', 'analytics_enabled', 'content'];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Invalid field' });
  }

  const projectRef = db.ref(`ExProjects/users/${payload.userId}/${project_slug}`);
  const projectSnapshot = await projectRef.once('value');
  const project = projectSnapshot.val();
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Handle content sanitization for hosted projects
  let finalValue = value;
  if (field === 'content' && project.type === 'hosted') {
    finalValue = sanitizeHTML(value);
  }

  // If name changed, handle slug update
  if (field === 'name') {
    const newSlug = cleanProjectName(value);
    if (newSlug !== project_slug) {
      // Check if new slug exists
      const newProjectRef = db.ref(`ExProjects/users/${payload.userId}/${newSlug}`);
      const existingSnapshot = await newProjectRef.once('value');
      if (existingSnapshot.exists()) {
        return res.status(400).json({ error: 'Project with this name already exists' });
      }
      
      // Update project with new slug
      project.name = value;
      project.slug = newSlug;
      project.updated_at = new Date().toISOString();
      
      if (project.type === 'hosted') {
        project.hosted_url = `${BASE_URL}/${payload.userId}/${newSlug}`;
      }
      
      // Save under new slug and remove old
      await newProjectRef.set(project);
      await projectRef.remove();
      
      // Update index
      await db.ref(`ExProjects/user_index/${payload.userId}/${newSlug}`).set(true);
      await db.ref(`ExProjects/user_index/${payload.userId}/${project_slug}`).remove();
      
      return res.json({
        message: 'Project updated successfully',
        project: {
          ...project,
          content: undefined
        },
        new_slug: newSlug
      });
    }
  }

  // Regular update without slug change
  await projectRef.update({ [field]: finalValue, updated_at: new Date().toISOString() });

  return res.json({
    message: 'Project updated successfully',
    project: { 
      ...project, 
      [field]: finalValue,
      content: undefined 
    }
  });
}

async function handleDeleteProject(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { project_slug } = req.body;

  if (!project_slug) {
    return res.status(400).json({ error: 'Project slug required' });
  }

  const projectRef = db.ref(`ExProjects/users/${payload.userId}/${project_slug}`);
  const projectSnapshot = await projectRef.once('value');
  const project = projectSnapshot.val();
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Delete project and associated analytics
  await projectRef.remove();
  await db.ref(`ExProjects/user_index/${payload.userId}/${project_slug}`).remove();
  
  // Clean up analytics if they exist
  if (project.analytics_enabled) {
    await db.ref(`ExAnalytics/projects/${project.projectId}`).remove();
    await db.ref(`ExAnalytics/visits/${project.projectId}`).remove();
    await db.ref(`ExAnalytics/unique/${project.projectId}`).remove();
    await db.ref(`ExAnalytics/user_projects/${payload.userId}/${project.projectId}`).remove();
  }

  return res.json({ message: 'Project deleted successfully' });
}

async function handleGetHostedProject(req, res, userId, projectSlug) {
  const projectRef = db.ref(`ExProjects/users/${userId}/${projectSlug}`);
  const projectSnapshot = await projectRef.once('value');
  const project = projectSnapshot.val();
  
  if (!project || project.type !== 'hosted' || project.visibility !== 'public') {
    return res.status(404).json({ error: 'Project not found' });
  }

  // For hosted projects, return the HTML content with security headers
  if (project.content) {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none';");
    return res.send(project.content);
  }

  return res.status(404).json({ error: 'Project content not found' });
}
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

const isValidUrl = (url) => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

// Generate screenshot using Microlink API
const generateWebsiteScreenshot = async (url, options = {}) => {
  const {
    width = 1200,
    height = 630,
    fullPage = false
  } = options;

  try {
    let apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}`;
    apiUrl += `&screenshot=true&meta=false&embed=screenshot.url`;
    apiUrl += `&viewport.width=${width}&viewport.height=${height}`;
    
    if (fullPage) {
      apiUrl += `&screenshot.fullPage=true`;
    }
    
    apiUrl += `&t=${Date.now()}`;

    // Verify the screenshot URL is accessible
    const response = await fetch(apiUrl, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error('Screenshot generation failed');
    }

    return apiUrl;
  } catch (error) {
    console.error('Screenshot generation error:', error);
    return null;
  }
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
      case 'refresh-screenshot':
        return await handleRefreshScreenshot(req, res);
      case 'check-screenshot':
        return await handleCheckScreenshotStatus(req, res);
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
    image,      // For image type only
    type, 
    visibility, 
    analytics,
    content,
    url         // For link type only - the external URL to screenshot
  } = req.body;

  if (!name || !type || !visibility) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const validTypes = ['image', 'link', 'hosted'];
  const validVisibilities = ['public', 'private', 'test'];

  if (!validTypes.includes(type) || !validVisibilities.includes(visibility)) {
    return res.status(400).json({ error: 'Invalid type or visibility' });
  }

  // Validation based on type
  if (type === 'image' && !image) {
    return res.status(400).json({ error: 'Image URL required for image type projects' });
  }
  
  if (type === 'link' && !url) {
    return res.status(400).json({ error: 'URL required for link type projects' });
  }

  const projectId = generateProjectId();
  const projectSlug = cleanProjectName(name);

  const projectRef = db.ref(`ExProjects/users/${payload.userId}/${projectSlug}`);
  const snapshot = await projectRef.once('value');
  if (snapshot.exists()) {
    return res.status(400).json({ error: 'Project with this name already exists' });
  }

  // Determine the final image URL based on project type
  let finalImage = DEFAULT_IMAGE;
  let targetUrl = null;
  let screenshotStatus = 'none';

  if (type === 'image') {
    // Image type: use provided image directly
    finalImage = image;
    screenshotStatus = 'not_applicable';
  } else if (type === 'link') {
    // Link type: use the provided external URL for screenshot
    targetUrl = url;
    if (isValidUrl(targetUrl)) {
      const screenshotUrl = await generateWebsiteScreenshot(targetUrl, {
        width: 1200,
        height: 630,
        fullPage: false
      });
      
      if (screenshotUrl) {
        finalImage = screenshotUrl;
        screenshotStatus = 'completed';
      } else {
        console.warn(`Failed to generate screenshot for ${targetUrl}, using default`);
        finalImage = DEFAULT_IMAGE;
        screenshotStatus = 'failed';
      }
    }
  } else if (type === 'hosted') {
    // Hosted type: generate the hosted URL first, then screenshot it later
    targetUrl = `${BASE_URL}/${payload.userId}/${projectSlug}`;
    finalImage = DEFAULT_IMAGE; // Placeholder initially
    screenshotStatus = 'pending';
  }

  const hostedUrl = type === 'hosted' ? `${BASE_URL}/${payload.userId}/${projectSlug}` : null;

  const project = {
    projectId,
    user_id: payload.userId,
    user_tag: payload.userTag,
    name,
    slug: projectSlug,
    logo: logo || DEFAULT_IMAGE,
    description: description || '',
    image: finalImage,
    original_url: (type === 'link') ? url : (type === 'hosted' ? hostedUrl : null),
    type,
    visibility,
    analytics_enabled: analytics === 'true' || analytics === true,
    content: type === 'hosted' ? sanitizeHTML(content) : null,
    screenshot_status: screenshotStatus,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    hosted_url: hostedUrl
  };

  // Store project
  await projectRef.set(project);
  await db.ref(`ExProjects/user_index/${payload.userId}/${projectSlug}`).set(true);

  // For hosted projects, generate screenshot AFTER the content is live
  if (type === 'hosted' && hostedUrl) {
    // Generate screenshot asynchronously - don't block the response
    generateWebsiteScreenshot(hostedUrl, {
      width: 1200,
      height: 630,
      fullPage: true
    }).then(async (screenshotUrl) => {
      if (screenshotUrl) {
        await projectRef.update({ 
          image: screenshotUrl,
          screenshot_status: 'completed',
          updated_at: new Date().toISOString()
        });
        console.log(`Screenshot generated for hosted project: ${projectSlug}`);
      } else {
        await projectRef.update({ 
          screenshot_status: 'failed',
          updated_at: new Date().toISOString()
        });
        console.error(`Failed to generate screenshot for hosted project ${projectSlug}`);
      }
    }).catch(async (error) => {
      console.error(`Screenshot generation error for ${projectSlug}:`, error);
      await projectRef.update({ 
        screenshot_status: 'failed',
        updated_at: new Date().toISOString()
      });
    });
  }

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
    publish_url: hostedUrl,
    screenshot_status: screenshotStatus
  });
}

async function handleCheckScreenshotStatus(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { project_slug } = req.query;

  if (!project_slug) {
    return res.status(400).json({ error: 'Project slug required' });
  }

  const projectRef = db.ref(`ExProjects/users/${payload.userId}/${project_slug}`);
  const projectSnapshot = await projectRef.once('value');
  const project = projectSnapshot.val();

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  return res.json({
    project_slug: project.slug,
    image: project.image,
    screenshot_status: project.screenshot_status || 'none',
    updated_at: project.updated_at
  });
}

async function handleRefreshScreenshot(req, res) {
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

  if (project.type !== 'link' && project.type !== 'hosted') {
    return res.status(400).json({ error: 'Screenshot refresh only available for link/hosted projects' });
  }

  // Determine the target URL for screenshot
  let targetUrl;
  if (project.type === 'link') {
    targetUrl = project.original_url;
  } else if (project.type === 'hosted') {
    targetUrl = project.hosted_url;
  }

  if (!targetUrl || !isValidUrl(targetUrl)) {
    return res.status(400).json({ error: 'No valid URL found for this project' });
  }

  // Update status to pending
  await projectRef.update({ 
    screenshot_status: 'pending',
    updated_at: new Date().toISOString()
  });

  // Generate new screenshot
  const screenshotUrl = await generateWebsiteScreenshot(targetUrl, {
    width: 1200,
    height: 630,
    fullPage: project.type === 'hosted'
  });

  if (!screenshotUrl) {
    await projectRef.update({ 
      screenshot_status: 'failed',
      updated_at: new Date().toISOString()
    });
    return res.status(500).json({ error: 'Failed to generate screenshot' });
  }

  await projectRef.update({ 
    image: screenshotUrl,
    screenshot_status: 'completed',
    updated_at: new Date().toISOString()
  });

  return res.json({ 
    message: 'Screenshot refreshed successfully',
    image_url: screenshotUrl,
    screenshot_status: 'completed'
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
        original_url: project.original_url,
        created_at: project.created_at,
        hosted_url: project.hosted_url,
        screenshot_status: project.screenshot_status
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

  const allowedFields = ['name', 'logo', 'description', 'image', 'original_url', 'type', 'visibility', 'analytics_enabled', 'content'];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Invalid field' });
  }

  const projectRef = db.ref(`ExProjects/users/${payload.userId}/${project_slug}`);
  const projectSnapshot = await projectRef.once('value');
  const project = projectSnapshot.val();

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  let finalValue = value;
  
  if (field === 'content' && project.type === 'hosted') {
    finalValue = sanitizeHTML(value);
  }

  // If updating original_url for link projects, regenerate screenshot
  if (field === 'original_url' && project.type === 'link') {
    if (isValidUrl(value)) {
      await projectRef.update({ 
        original_url: value,
        screenshot_status: 'pending',
        updated_at: new Date().toISOString()
      });

      const screenshotUrl = await generateWebsiteScreenshot(value, {
        width: 1200,
        height: 630,
        fullPage: false
      });
      
      if (screenshotUrl) {
        await projectRef.update({ 
          image: screenshotUrl,
          screenshot_status: 'completed',
          updated_at: new Date().toISOString()
        });
        
        return res.json({
          message: 'URL and screenshot updated successfully',
          project: { 
            ...project, 
            original_url: value,
            image: screenshotUrl,
            content: undefined 
          }
        });
      } else {
        await projectRef.update({ 
          screenshot_status: 'failed',
          updated_at: new Date().toISOString()
        });
      }
    }
  }

  // If updating content for hosted projects, offer to refresh screenshot
  if (field === 'content' && project.type === 'hosted') {
    // Update content first
    await projectRef.update({ 
      [field]: finalValue, 
      updated_at: new Date().toISOString() 
    });

    // Optionally trigger screenshot refresh (can be done via separate endpoint)
    return res.json({
      message: 'Content updated successfully. Use refresh-screenshot to update preview.',
      project: { 
        ...project, 
        [field]: finalValue,
        content: undefined 
      }
    });
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
        project.original_url = project.hosted_url;
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
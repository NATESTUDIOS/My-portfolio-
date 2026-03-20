// api/analytics.js
import { db } from "../utils/firebase.js";
import { verifyToken } from "./auth.js";
import crypto from 'crypto';

const BASE_URL = process.env.BASE_URL;

const hashIP = (ip) => {
  return crypto.createHash('sha256').update(ip + process.env.JWT_SECRET).digest('hex');
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, project_id } = req.query;

  try {
    // Public tracking endpoint - uses project_id, not slug
    if (req.method === 'GET' && action === 'track' && project_id) {
      return await handleTracking(req, res, project_id);
    }

    switch (action) {
      case 'create':
        return await handleCreateSession(req, res);
      case 'list':
        return await handleListSessions(req, res);
      case 'delete':
        return await handleDeleteSession(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Analytics API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleCreateSession(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { project_name, link, project_id } = req.body;

  if (!project_name || !project_id) {
    return res.status(400).json({ error: 'Project name and project_id are required' });
  }

  const session = {
    project_id,
    project_name,
    link: link || null,
    user_id: payload.userId,
    user_tag: payload.userTag,
    created_at: new Date().toISOString(),
    tracking_url: `${BASE_URL}/api/analytics?action=track&project_id=${project_id}`,
    total_visits: 0,
    unique_visitors: 0
  };

  // Store session by project_id (not slug)
  const sessionRef = db.ref(`ExAnalytics/projects/${project_id}`);
  await sessionRef.set(session);
  
  // Add to user's projects list
  await db.ref(`ExAnalytics/user_projects/${payload.userId}/${project_id}`).set(true);

  return res.status(201).json({
    message: 'Analytics session created',
    project_id,
    tracking_url: session.tracking_url
  });
}

async function handleTracking(req, res, projectId) {
  const sessionRef = db.ref(`ExAnalytics/projects/${projectId}`);
  const sessionSnapshot = await sessionRef.once('value');
  const session = sessionSnapshot.val();
  
  if (!session) {
    return res.status(404).json({ error: 'Analytics session not found' });
  }

  // Collect tracking data
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const referrer = req.headers['referer'] || req.headers['referrer'] || 'direct';
  const ipHash = hashIP(ip);
  
  // Check if it's a direct call
  const origin = req.headers['origin'];
  const isDirect = session.link && (
    (referrer && referrer.startsWith(session.link)) ||
    (origin && origin.startsWith(session.link))
  );

  // Check for unique visitor (24h window)
  const uniqueRef = db.ref(`ExAnalytics/unique/${projectId}/${ipHash}`);
  const uniqueSnapshot = await uniqueRef.once('value');
  const lastVisit = uniqueSnapshot.val();
  const now = Date.now();
  const isUnique = !lastVisit || (now - lastVisit > 24 * 60 * 60 * 1000);

  if (isUnique) {
    await uniqueRef.set(now);
    await sessionRef.child('unique_visitors').transaction(current => (current || 0) + 1);
  }

  const visitId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const visitData = {
    ip_hash: ipHash,
    user_agent: userAgent,
    referrer,
    timestamp: new Date().toISOString(),
    project_id: projectId,
    is_direct: isDirect,
    is_unique: isUnique
  };

  // Store visit
  await db.ref(`ExAnalytics/visits/${projectId}/${visitId}`).set(visitData);

  // Update total visits
  await sessionRef.child('total_visits').transaction(current => (current || 0) + 1);

  // Return tracking response
  res.setHeader('Content-Type', 'application/json');
  return res.json({ 
    tracked: true,
    project_id: projectId,
    timestamp: visitData.timestamp
  });
}

async function handleListSessions(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Get all projects for user
  const userProjectsRef = db.ref(`ExAnalytics/user_projects/${payload.userId}`);
  const projectsSnapshot = await userProjectsRef.once('value');
  const projectIds = projectsSnapshot.val() ? Object.keys(projectsSnapshot.val()) : [];
  
  const sessions = [];

  for (const projectId of projectIds) {
    const sessionRef = db.ref(`ExAnalytics/projects/${projectId}`);
    const sessionSnapshot = await sessionRef.once('value');
    const session = sessionSnapshot.val();
    
    if (session) {
      // Get recent visits (last 100)
      const visitsRef = db.ref(`ExAnalytics/visits/${projectId}`);
      const visitsSnapshot = await visitsRef.orderByKey().limitToLast(100).once('value');
      const visits = visitsSnapshot.val() ? Object.values(visitsSnapshot.val()) : [];
      
      sessions.push({
        ...session,
        recent_visits: visits
      });
    }
  }

  return res.json({ sessions });
}

async function handleDeleteSession(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { project_id } = req.body;

  if (!project_id) {
    return res.status(400).json({ error: 'Project ID required' });
  }

  const sessionRef = db.ref(`ExAnalytics/projects/${project_id}`);
  const sessionSnapshot = await sessionRef.once('value');
  const session = sessionSnapshot.val();
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.user_id !== payload.userId) {
    return res.status(403).json({ error: 'Cannot delete another user\'s session' });
  }

  // Delete all associated data
  await db.ref(`ExAnalytics/visits/${project_id}`).remove();
  await db.ref(`ExAnalytics/unique/${project_id}`).remove();
  await sessionRef.remove();
  await db.ref(`ExAnalytics/user_projects/${payload.userId}/${project_id}`).remove();

  return res.json({ message: 'Session deleted successfully' });
}
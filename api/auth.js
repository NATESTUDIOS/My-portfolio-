// api/auth.js
import { db } from "../utils/firebase.js";
import crypto from 'crypto';

const DEFAULT_IMAGE = 'https://picsum.photos/200/200';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const BASE_URL = process.env.BASE_URL;

// Helper functions
const generateUserId = () => {
  return `exuser_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
};

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(password + salt).digest('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  const [salt, hash] = stored.split(':');
  const newHash = crypto.createHash('sha256').update(password + salt).digest('hex');
  return newHash === hash;
};

const generateToken = (userId, userTag) => {
  const payload = {
    userId,
    userTag,
    iss: 'exploits',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60)
  };
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(base64Payload).digest('base64');
  return `${base64Payload}.${signature}`;
};

export const verifyToken = (token) => {
  try {
    const [base64Payload, signature] = token.split('.');
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(base64Payload).digest('base64');

    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
};

const cleanUserTag = (tag) => {
  return tag.toLowerCase().replace(/[^a-z0-9]/g, '');
};

// New function to clean email for Firebase path
const cleanEmail = (email) => {
  if (!email) return '';
  // Replace Firebase invalid characters: . # $ [ ] /
  // Common approach: replace dots with commas or other safe character
  return email
    .replace(/\./g, ',')  // Replace dots with commas
    .replace(/#/g, '_hash_')
    .replace(/\$/g, '_dollar_')
    .replace(/\[/g, '_lb_')
    .replace(/\]/g, '_rb_')
    .replace(/\//g, '_slash_');
};

// Helper function to reverse the email cleaning (if needed)
const unescapeEmail = (cleanedEmail) => {
  if (!cleanedEmail) return '';
  return cleanedEmail
    .replace(/,/g, '.')
    .replace(/_hash_/g, '#')
    .replace(/_dollar_/g, '$')
    .replace(/_lb_/g, '[')
    .replace(/_rb_/g, ']')
    .replace(/_slash_/g, '/');
};

// Updated sanitizeHTML function that preserves JavaScript functionality
const sanitizeHTML = (html) => {
  if (!html) return null;

  // Remove only dangerous inline event handlers
  let sanitized = html.replace(/\s+on\w+="[^"]*"/gi, '');
  sanitized = sanitized.replace(/\s+on\w+='[^']*'/gi, '');

  // Remove javascript: links (replace with # to maintain link structure)
  sanitized = sanitized.replace(/javascript:/gi, '#');

  // Allow script tags and their contents to remain
  // Allow data-* attributes (they're safe)
  // Allow all other HTML content

  return sanitized;
};

// Helper function to parse request body
const parseBody = async (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (body) {
          resolve(JSON.parse(body));
        } else {
          resolve({});
        }
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
};

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse body for POST, PUT, DELETE requests
  let body = {};
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    try {
      body = await parseBody(req);
      req.body = body;
    } catch (error) {
      console.error('Error parsing body:', error);
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
  }

  const { action, user_tag } = req.query;

  try {
    // Public portfolio endpoint - BASE_URL/:user_tag
    if (req.method === 'GET' && user_tag && !action) {
      return await handleGetPortfolio(req, res, user_tag);
    }

    switch (action) {
      case 'create':
        return await handleCreate(req, res);
      case 'login':
        return await handleLogin(req, res);
      case 'edit':
        return await handleEdit(req, res);
      case 'delete':
        return await handleDelete(req, res);
      case 'portfolio':
        return await handlePortfolioActions(req, res);
      case 'profile':  // NEW: Public profile endpoint for portfolio page
        return await handleGetPublicProfile(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Auth API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleCreate(req, res) {
  const { email, password, user_tag, icon, description, portfolio_type, portfolio_content, portfolio_redirect } = req.body;

  if (!email || !password || !user_tag) {
    return res.status(400).json({ error: 'Email, password, and user_tag are required' });
  }

  const cleanTag = cleanUserTag(user_tag);
  const cleanEmailKey = cleanEmail(email);

  // Check if user_tag exists
  const userRef = db.ref(`ExAuths/users/${cleanTag}`);
  const snapshot = await userRef.once('value');
  if (snapshot.exists()) {
    return res.status(400).json({ error: 'User tag already exists' });
  }

  // Check if email exists using cleaned email key
  const emailRef = db.ref(`ExAuths/email_index/${cleanEmailKey}`);
  const emailSnapshot = await emailRef.once('value');
  if (emailSnapshot.exists()) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  const userId = generateUserId();
  const hashedPassword = hashPassword(password);

  // Portfolio setup
  const portfolio = {
    type: portfolio_type || 'none', // 'none', 'hosted', 'redirect'
    content: portfolio_type === 'hosted' ? sanitizeHTML(portfolio_content) : null,
    redirect_url: portfolio_type === 'redirect' ? portfolio_redirect : null,
    last_updated: new Date().toISOString()
  };

  const user = {
    userId,
    email, // Store original email in user object
    password: hashedPassword,
    user_tag: cleanTag,
    icon: icon || DEFAULT_IMAGE,
    description: description || '',
    portfolio,
    portfolio_url: `${BASE_URL}/${cleanTag}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Store user by tag
  await userRef.set(user);

  // Store email index using cleaned email key
  await db.ref(`ExAuths/email_index/${cleanEmailKey}`).set(cleanTag);

  // Store mappings
  await db.ref(`ExAuths/userids/${userId}`).set(cleanTag);
  await db.ref(`ExAuths/usertags/${cleanTag}`).set(userId);

  const token = generateToken(userId, cleanTag);

  return res.status(201).json({
    message: 'User created successfully',
    userId,
    user_tag: cleanTag,
    portfolio_url: user.portfolio_url,
    token,
    expires_in: '14d'
  });
}

async function handleLogin(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Clean email for Firebase path lookup
  const cleanEmailKey = cleanEmail(email);

  // Get user_tag from email index using cleaned email key (O(1) lookup)
  const emailRef = db.ref(`ExAuths/email_index/${cleanEmailKey}`);
  const emailSnapshot = await emailRef.once('value');
  const userTag = emailSnapshot.val();

  if (!userTag) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Get user data
  const userRef = db.ref(`ExAuths/users/${userTag}`);
  const userSnapshot = await userRef.once('value');
  const user = userSnapshot.val();

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Verify password
  if (!verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user.userId, userTag);

  return res.json({
    message: 'Login successful',
    userId: user.userId,
    user_tag: userTag,
    portfolio_url: user.portfolio_url,
    token,
    expires_in: '14d'
  });
}

async function handleEdit(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { field, value } = req.body;

  if (!field || value === undefined) {
    return res.status(400).json({ error: 'Field and value are required' });
  }

  const allowedFields = ['icon', 'description'];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Invalid field' });
  }

  // Get current user
  const userRef = db.ref(`ExAuths/users/${payload.userTag}`);
  await userRef.update({ 
    [field]: value, 
    updated_at: new Date().toISOString() 
  });

  return res.json({
    message: 'User updated successfully',
    updated_field: field
  });
}

async function handleDelete(req, res) {
  const adminKey = req.headers['x-admin-key'];

  if (!adminKey || adminKey !== ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { user_tag } = req.body;

  if (!user_tag) {
    return res.status(400).json({ error: 'User tag required' });
  }

  const cleanTag = cleanUserTag(user_tag);
  const userRef = db.ref(`ExAuths/users/${cleanTag}`);
  const snapshot = await userRef.once('value');
  const user = snapshot.val();

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Clean email for index removal
  const cleanEmailKey = cleanEmail(user.email);

  // Delete all user data
  await userRef.remove();
  await db.ref(`ExAuths/email_index/${cleanEmailKey}`).remove();
  await db.ref(`ExAuths/userids/${user.userId}`).remove();
  await db.ref(`ExAuths/usertags/${cleanTag}`).remove();

  return res.json({ message: 'User deleted successfully' });
}

async function handlePortfolioActions(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { subaction, portfolio_type, portfolio_content, portfolio_redirect } = req.body;

  const userRef = db.ref(`ExAuths/users/${payload.userTag}`);
  const userSnapshot = await userRef.once('value');
  const user = userSnapshot.val();

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  switch (subaction) {
    case 'update':
      const portfolio = {
        type: portfolio_type || user.portfolio?.type || 'none',
        content: portfolio_type === 'hosted' ? sanitizeHTML(portfolio_content) : null,
        redirect_url: portfolio_type === 'redirect' ? portfolio_redirect : null,
        last_updated: new Date().toISOString()
      };

      await userRef.update({
        portfolio,
        updated_at: new Date().toISOString()
      });

      return res.json({
        message: 'Portfolio updated successfully',
        portfolio_url: user.portfolio_url,
        portfolio
      });

    case 'get':
      return res.json({
        portfolio: user.portfolio || { type: 'none' },
        portfolio_url: user.portfolio_url
      });

    case 'disable':
      await userRef.update({
        'portfolio.type': 'none',
        'portfolio.content': null,
        'portfolio.redirect_url': null,
        'portfolio.last_updated': new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      return res.json({
        message: 'Portfolio disabled successfully'
      });

    default:
      return res.status(400).json({ error: 'Invalid subaction' });
  }
}

async function handleGetPortfolio(req, res, userTag) {
  const cleanTag = cleanUserTag(userTag);

  const userRef = db.ref(`ExAuths/users/${cleanTag}`);
  const userSnapshot = await userRef.once('value');
  const user = userSnapshot.val();

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const portfolio = user.portfolio || { type: 'none' };

  switch (portfolio.type) {
    case 'hosted':
      if (portfolio.content) {
        // Set security headers for hosted HTML
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');

        // Updated CSP that allows scripts, styles, and images
        res.setHeader(
          'Content-Security-Policy', 
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https:;"
        );

        return res.send(portfolio.content);
      }
      return res.status(404).json({ error: 'Portfolio content not found' });

    case 'redirect':
      if (portfolio.redirect_url) {
        return res.redirect(302, portfolio.redirect_url);
      }
      return res.status(404).json({ error: 'Redirect URL not configured' });

    case 'none':
    default:
      // Return basic user profile as JSON
      return res.json({
        user_tag: user.user_tag,
        icon: user.icon,
        description: user.description,
        portfolio_url: user.portfolio_url,
        message: 'This user has not set up a portfolio yet'
      });
  }
}

// NEW: Public profile endpoint for portfolio page
async function handleGetPublicProfile(req, res) {
  const { user_tag } = req.query;
  
  if (!user_tag) {
    return res.status(400).json({ error: 'User tag required' });
  }

  const cleanTag = cleanUserTag(user_tag);
  const userRef = db.ref(`ExAuths/users/${cleanTag}`);
  const userSnapshot = await userRef.once('value');
  const user = userSnapshot.val();

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Return complete public profile data for portfolio page
  return res.json({
    // Basic info
    user_tag: user.user_tag,
    userId: user.userId,
    icon: user.icon,
    description: user.description,
    portfolio_url: user.portfolio_url,
    created_at: user.created_at,
    
    // Portfolio configuration
    portfolio: {
      type: user.portfolio?.type || 'none',
      content: null, // Don't expose content for security (handled by separate endpoint)
      redirect_url: user.portfolio?.type === 'redirect' ? user.portfolio?.redirect_url : null
    },
    
    // Metadata
    message: user.portfolio?.type === 'none' ? 'This user has a minimal profile' : 'Portfolio configured'
  });
}
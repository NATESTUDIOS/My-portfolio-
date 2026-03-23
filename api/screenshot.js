// api/screenshot.js
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { URL } from 'url';

// Validate URL
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Cache browser instance between function invocations
let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }
  
  console.log('Launching browser...');
  browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--font-render-hinting=none'
    ],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: chromium.defaultViewport
  });
  console.log('Browser launched');
  return browser;
}

async function handleScreenshot(req, res, params) {
  const startTime = Date.now();
  let page = null;
  
  try {
    const { 
      url, 
      width = 1920, 
      height = 1080, 
      fullPage = false, 
      type = 'png', 
      quality = 80,
      waitUntil = 'networkidle2',
      timeout = 25000,
      selector,
      darkMode = false,
      device,
      format = 'base64'
    } = params;
    
    // Validate URL
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL. Must be http:// or https://' });
    }
    
    // Parse parameters
    const viewportWidth = parseInt(width, 10);
    const viewportHeight = parseInt(height, 10);
    const imageQuality = Math.min(100, Math.max(0, parseInt(quality, 10)));
    const isFullPage = fullPage === 'true' || fullPage === true;
    const imageType = type === 'jpeg' ? 'jpeg' : 'png';
    const waitUntilOption = ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'].includes(waitUntil) 
      ? waitUntil 
      : 'networkidle2';
    const timeoutMs = parseInt(timeout, 10) || 25000;
    const enableDarkMode = darkMode === 'true' || darkMode === true;
    const returnFormat = format === 'buffer' ? 'buffer' : 'base64';
    
    if (isNaN(viewportWidth) || isNaN(viewportHeight)) {
      return res.status(400).json({ error: 'Width and height must be valid numbers' });
    }
    
    console.log(`Screenshot: ${url} (${viewportWidth}x${viewportHeight}, fullPage: ${isFullPage})`);
    
    // Get browser and create page
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    
    // Set viewport
    await page.setViewport({ width: viewportWidth, height: viewportHeight });
    
    // Set device preset if specified
    const devices = {
      'iPhone 12': { width: 390, height: 844, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1' },
      'iPad Pro': { width: 1024, height: 1366, userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1' },
      'Pixel 5': { width: 393, height: 851, userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36' },
      'Desktop 1080p': { width: 1920, height: 1080, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      'Desktop 4K': { width: 3840, height: 2160, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };
    
    if (device && devices[device]) {
      await page.setViewport({ width: devices[device].width, height: devices[device].height });
      await page.setUserAgent(devices[device].userAgent);
    } else {
      // Set user agent to avoid being blocked
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    }
    
    // Enable dark mode if requested
    if (enableDarkMode) {
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: 'dark' }
      ]);
    }
    
    // Add custom headers to avoid detection
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });
    
    // Navigate to URL with timeout
    await page.goto(url, {
      waitUntil: waitUntilOption,
      timeout: timeoutMs
    }).catch(error => {
      throw new Error(`Navigation failed: ${error.message}`);
    });
    
    // Wait for additional time to ensure dynamic content loads
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // If selector is provided, wait for it and scroll to it
    if (selector) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        const element = await page.$(selector);
        if (element) {
          await element.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.warn(`Selector ${selector} not found:`, error.message);
      }
    }
    
    // Take screenshot
    const screenshotOptions = {
      type: imageType,
      fullPage: isFullPage,
      encoding: returnFormat === 'buffer' ? undefined : 'base64'
    };
    
    if (imageType === 'jpeg') {
      screenshotOptions.quality = imageQuality;
    }
    
    // If selector is provided, take screenshot of that element
    let screenshot;
    if (selector) {
      const element = await page.$(selector);
      if (element) {
        screenshot = await element.screenshot(screenshotOptions);
      } else {
        screenshot = await page.screenshot(screenshotOptions);
      }
    } else {
      screenshot = await page.screenshot(screenshotOptions);
    }
    
    // Close page
    await page.close();
    
    // Send response
    const duration = Date.now() - startTime;
    console.log(`Screenshot completed in ${duration}ms`);
    
    if (returnFormat === 'buffer') {
      res.setHeader('Content-Type', `image/${imageType}`);
      res.setHeader('X-Screenshot-Time', duration);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(screenshot);
    } else {
      return res.status(200).json({
        success: true,
        screenshot: screenshot,
        format: imageType,
        duration,
        dimensions: { width: viewportWidth, height: viewportHeight },
        fullPage: isFullPage
      });
    }
    
  } catch (error) {
    console.error('Screenshot error:', error);
    
    if (page) {
      await page.close().catch(() => {});
    }
    
    return res.status(500).json({
      success: false,
      error: 'Failed to take screenshot',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function handleHealth(req, res) {
  return res.status(200).json({
    status: 'ok',
    environment: 'vercel',
    timestamp: new Date().toISOString(),
    runtime: process.version,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
}

async function handleInfo(req, res) {
  return res.status(200).json({
    name: 'Screenshot API',
    version: '1.0.0',
    description: 'Take screenshots of any website',
    endpoints: {
      screenshot: {
        method: 'GET',
        path: '/api/screenshot',
        description: 'Take a screenshot of a URL',
        parameters: {
          url: { type: 'string', required: true, description: 'URL to screenshot' },
          width: { type: 'number', default: 1920, description: 'Viewport width' },
          height: { type: 'number', default: 1080, description: 'Viewport height' },
          fullPage: { type: 'boolean', default: false, description: 'Take full page screenshot' },
          type: { type: 'string', enum: ['png', 'jpeg'], default: 'png', description: 'Image format' },
          quality: { type: 'number', default: 80, description: 'JPEG quality (0-100)' },
          waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'], default: 'networkidle2' },
          timeout: { type: 'number', default: 25000, description: 'Navigation timeout in ms' },
          selector: { type: 'string', description: 'CSS selector to screenshot specific element' },
          darkMode: { type: 'boolean', default: false, description: 'Enable dark mode' },
          device: { type: 'string', enum: ['iPhone 12', 'iPad Pro', 'Pixel 5', 'Desktop 1080p', 'Desktop 4K'], description: 'Device preset' },
          format: { type: 'string', enum: ['base64', 'buffer'], default: 'base64', description: 'Response format' }
        },
        example: '/api/screenshot?url=https://example.com&width=1280&height=720&type=jpeg'
      },
      health: {
        method: 'GET',
        path: '/api/screenshot?health=true',
        description: 'Health check endpoint'
      },
      info: {
        method: 'GET',
        path: '/api/screenshot?info=true',
        description: 'API information'
      }
    },
    usage: {
      curl: 'curl "https://your-app.vercel.app/api/screenshot?url=https://example.com" --output screenshot.png',
      javascript: 'fetch("https://your-app.vercel.app/api/screenshot?url=https://example.com").then(res => res.json())',
      html: '<img src="https://your-app.vercel.app/api/screenshot?url=https://example.com&format=buffer" alt="Screenshot">'
    }
  });
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests for screenshot
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, health, info, ...params } = req.query;

  try {
    // Health check endpoint
    if (health === 'true' || action === 'health') {
      return await handleHealth(req, res);
    }
    
    // API info endpoint
    if (info === 'true' || action === 'info') {
      return await handleInfo(req, res);
    }
    
    // Default to screenshot
    return await handleScreenshot(req, res, params);
    
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
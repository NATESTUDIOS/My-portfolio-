// /api/image-suggest.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { text, count = 3 } = req.body;

  if (!text || typeof text !== "string") {
    return res.status(400).json({ success: false, error: "Text is required" });
  }

  try {
    const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
    const query = encodeURIComponent(text);
    const url = `https://api.unsplash.com/search/photos?query=${query}&per_page=${count}&client_id=${UNSPLASH_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    const images = data.results.map((img) => ({
      id: img.id,
      description: img.alt_description,
      url: img.urls.regular,
      color: img.color,
      author: img.user.name,
      profile: img.user.links.html,
    }));

    res.status(200).json({
      success: true,
      query: text,
      count: images.length,
      images,
    });
  } catch (err) {
    console.error("Image fetch error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch images" });
  }
}

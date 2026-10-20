// /api/feeds/<anything> serves the same data as /api/feeds.
// Handy for checking a fresh copy when something in between caches by path.
export { onRequestGet } from "../feeds.js";

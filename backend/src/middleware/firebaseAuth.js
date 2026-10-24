import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let firebaseAuth = null;
let initializationError = null;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID || "inventory-intelligence-a880e";
  if (!/^[a-z0-9-]+$/.test(projectId)) {
    throw new Error("Invalid Firebase project configuration");
  }
  const firebaseApp =
    getApps()[0] ||
    initializeApp({
      projectId,
    });
  firebaseAuth = getAuth(firebaseApp);
} catch (error) {
  initializationError = error;
}

export const createFirebaseAuthMiddleware = ({ verifyIdToken } = {}) => {
  const verify = verifyIdToken || ((token) => firebaseAuth.verifyIdToken(token));

  return async (req, res, next) => {
    if (!verifyIdToken && (!firebaseAuth || initializationError)) {
      return res.status(503).json({ message: "Firebase authentication is unavailable" });
    }
    const authorization = String(req.headers.authorization || "").trim();
    if (!authorization) {
      return res.status(401).json({ message: "Authorization is required" });
    }

    const tokenMatch = authorization.match(/^Bearer\s+(\S+)$/i);
    if (!tokenMatch) {
      return res.status(401).json({ message: "Invalid authorization token" });
    }

    try {
      req.user = await verify(tokenMatch[1]);
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid or expired authorization token" });
    }
  };
};

export const requireFirebaseAuth = createFirebaseAuthMiddleware();

import express from "express";
import { askAiAnalyst } from "../controllers/aiAnalystController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";

const router = express.Router();

router.post("/", requireFirebaseAuth, askAiAnalyst);

export default router;

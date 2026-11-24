import express from "express";
import csvUpload from "../config/multer.js";
import { uploadSalesCsv } from "../controllers/uploadController.js";
import { requireSessionMembership } from "../middleware/clerkAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

const router = express.Router();

router.use(requireSessionMembership, requireTenantContext);

router.post("/", csvUpload.single("file"), uploadSalesCsv);

export default router;

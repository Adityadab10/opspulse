import express from "express";
import csvUpload from "../config/multer.js";
import { uploadSalesCsv } from "../controllers/uploadController.js";
import { requireFirebaseAuth } from "../middleware/firebaseAuth.js";
import { requireTenantContext } from "../middleware/tenantContext.js";

const router = express.Router();

router.use(requireFirebaseAuth, requireTenantContext);

router.post("/", csvUpload.single("file"), uploadSalesCsv);

export default router;

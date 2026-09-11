import { normalizeCsvRow, parseCsvBuffer } from "../helpers/csvHelpers.js";
import { importCsvSales } from "../config/postgres.js";

export const uploadSalesCsv = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        message: "CSV file is required (field name: file)",
      });
    }

    const rawRows = await parseCsvBuffer(req.file.buffer);
    if (!rawRows.length) {
      return res.status(400).json({ message: "CSV is empty", valid: 0, invalid: 0 });
    }

    let validRows = [];
    const invalidRows = [];

    rawRows.forEach((row, index) => {
      const normalized = normalizeCsvRow(row);
      if (normalized && Number.isInteger(normalized.quantity)) {
        const productKey = `${normalized.productName.toLowerCase()}__${normalized.category.toLowerCase()}`;
        validRows.push({ ...normalized, productKey, rowIndex: index + 1 });
      } else {
        invalidRows.push({
          rowIndex: index + 1,
          rawRow: row,
          reason: "Missing or invalid required fields (productName, category, positive integer quantity, date)",
        });
      }
    });

    // Track product creation vs update
    const uniqueProducts = new Map();
    for (const row of validRows) {
      if (!uniqueProducts.has(row.productKey)) {
        uniqueProducts.set(row.productKey, {
          key: row.productKey,
          name: row.productName,
          category: row.category,
        });
      }
    }

    const { productsCreated, salesRecordsInserted } = await importCsvSales(
      Array.from(uniqueProducts.values()),
      validRows,
    );

    const summary = {
      totalRows: rawRows.length,
      validRows: validRows.length,
      invalidRows: invalidRows.length,
      productsCreated,
      salesRecordsInserted,
      invalidDetails: invalidRows,
    };

    return res.status(201).json({
      message: "Sales data uploaded successfully",
      summary,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to process CSV upload",
      error: error.message,
    });
  }
};

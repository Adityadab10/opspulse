import test from "node:test";
import assert from "node:assert/strict";

import { createProduct, deleteProduct, getProduct, updateProduct } from "./productController.js";

const responseRecorder = () => {
  const response = { statusCode: 200, body: null };
  const res = {
    status(statusCode) {
      response.statusCode = statusCode;
      return res;
    },
    json(body) {
      response.body = body;
      return res;
    },
    send(body) {
      response.body = body;
      return res;
    },
  };
  return { response, res };
};

test("create product returns field-level validation errors before database access", async () => {
  const { response, res } = responseRecorder();
  await createProduct({ authContext: { tenantId: "tenant-a" }, body: { name: "", category: 4 } }, res);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    message: "Product validation failed",
    errors: { name: "name is required", category: "category is required" },
  });
});

test("update product rejects malformed references and invalid fields", async () => {
  const invalidReference = responseRecorder();
  await updateProduct({ params: { productId: "not-a-product" }, body: { name: "A", category: "B" } }, invalidReference.res);
  assert.equal(invalidReference.response.statusCode, 400);
  assert.deepEqual(invalidReference.response.body, { message: "Invalid productId" });

  const invalidFields = responseRecorder();
  await updateProduct({ params: { productId: "507f1f77bcf86cd799439011" }, body: { name: "", category: "B" } }, invalidFields.res);
  assert.equal(invalidFields.response.statusCode, 400);
  assert.deepEqual(invalidFields.response.body.errors, { name: "name is required" });
});

test("read and delete reject malformed references before querying tenant data", async () => {
  const read = responseRecorder();
  await getProduct({ params: { productId: "bad" } }, read.res);
  assert.equal(read.response.statusCode, 400);

  const remove = responseRecorder();
  await deleteProduct({ params: { productId: "bad" } }, remove.res);
  assert.equal(remove.response.statusCode, 400);
});

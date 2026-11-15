import test from "node:test";
import assert from "node:assert/strict";
import { appendConversationTurn, resetAnalystConversation } from "./aiAnalystSupport.js";

test("analyst conversation is bounded and resettable for tenant changes", () => {
  const turns = Array.from({ length: 8 }, (_, index) => ({ question: `${index}`, answer: `${index}` }));
  assert.deepEqual(appendConversationTurn(turns, { question: "new", answer: "new" }).map((turn) => turn.question), ["1", "2", "3", "4", "5", "6", "7", "new"]);
  assert.deepEqual(resetAnalystConversation(), { question: "", answer: null, conversation: [], error: "" });
});

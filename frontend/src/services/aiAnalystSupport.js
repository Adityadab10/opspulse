export const appendConversationTurn = (turns, turn) => [...turns, turn].slice(-8);

export const resetAnalystConversation = () => ({ question: "", answer: null, conversation: [], error: "" });

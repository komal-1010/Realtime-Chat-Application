import { useEffect, useState } from "react";
const API = "http://localhost:3000";

export default function ChatWindow({ token, chatId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  async function loadMessages() {
    if (!chatId) return;

    const res = await fetch(`${API}/chats/${chatId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    setMessages(data.messages);
  }

  useEffect(() => {
    loadMessages();
  }, [chatId]);

  async function sendMessage() {
    if (!input.trim()) return;

    // send question
    const res = await fetch(`${API}/ask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question: input, chatId }),
    });

    const data = await res.json();
    setInput("");

    loadMessages();
  }

  return (
    <div style={{ flex: 1, padding: "20px", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto", marginBottom: "10px" }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: "10px" }}>
            <b>{msg.role === "user" ? "You" : "AI"}: </b> {msg.text}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <input
          style={{ flex: 1, padding: "10px" }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
        />
        <button onClick={sendMessage} style={{ padding: "10px 20px" }}>
          Send
        </button>
      </div>
    </div>
  );
}

import React, { useState } from "react";


const ChatUI = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const sendMessage = async () => {
    if (!input.trim()) return;

    // Add user message
    const newMessage = { sender: "user", text: input };
    setMessages((prev) => [...prev, newMessage]);

    const question = input;
    setInput("");

    // Send to backend
    const res = await fetch("http://localhost:3000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        question,
        history:messages 
    }),
    });

    const data = await res.json();

    // Add bot response
    setMessages((prev) => [
      ...prev,
      { sender: "bot", text: data.answer || "No answer" },
    ]);
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 600,
        margin: "20px auto",
        padding: 20,
        border: "1px solid #ccc",
        borderRadius: 10,
      }}
    >
      <h2>AI Chatbot</h2>

      <div
        style={{
          height: 400,
          overflowY: "auto",
          border: "1px solid #ddd",
          padding: 10,
          marginBottom: 10,
        }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              marginBottom: 10,
              textAlign: msg.sender === "user" ? "right" : "left",
            }}
          >
            <b>{msg.sender === "user" ? "You" : "Bot"}:</b> {msg.text}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          style={{ flex: 1, padding: 10 }}
        />

        <button
          onClick={sendMessage}
          style={{ padding: "10px 20px", cursor: "pointer" }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatUI;

import { useEffect, useState } from "react";

const API = "http://localhost:3000";

export default function ChatSidebar({ token, activeChatId, onSelectChat, onNewChat }) {
  const [chats, setChats] = useState([]);

  async function loadChats() {
    const res = await fetch(`${API}/chats`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json();
    setChats(data.chats);
  }

  useEffect(() => {
    loadChats();
  }, []);

  async function deleteChat(chatId) {
    await fetch(`${API}/chats/${chatId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    loadChats();
  }

  return (
    <div style={{ width: "250px", background: "#f1f1f1", padding: "10px", display: "flex", flexDirection: "column" }}>
      <button onClick={onNewChat} style={{ padding: "8px", marginBottom: "10px" }}>
        + New Chat
      </button>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {chats.map((chat) => (
          <div
            key={chat._id}
            onClick={() => onSelectChat(chat._id)}
            style={{
              padding: "10px",
              cursor: "pointer",
              background: chat._id === activeChatId ? "#e0e0e0" : "transparent",
              borderRadius: "5px",
              marginBottom: "5px"
            }}
          >
            <div>{chat.title}</div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteChat(chat._id);
              }}
              style={{
                marginTop: "5px",
                padding: "3px",
                background: "red",
                color: "white",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
              }}
            >
              delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

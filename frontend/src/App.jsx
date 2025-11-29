import { useState } from "react";
import ChatWindow from "./component/chatWindow";
import ChatSidebar from "./component/chatSidebar";


const API = "http://localhost:3000";

function App() {
  const token = localStorage.getItem("token"); // or from context
  const [activeChat, setActiveChat] = useState(null);

  async function newChat() {
    const res = await fetch(`${API}/chats`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    setActiveChat(data.chatId);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <ChatSidebar
        token={token}
        activeChatId={activeChat}
        onSelectChat={setActiveChat}
        onNewChat={newChat}
      />

      <ChatWindow token={token} chatId={activeChat} />
    </div>
  );
}

export default App;
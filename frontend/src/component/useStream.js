export async function useStream(question,chunk) {
    const res=await fetch("http://localhost:3000/ask/stream",{
        method:"POST",
        headers:{"Content-Type":'application/json'},
        body:JSON.stringify({question})
    })
    const reader=res.body.getReader();
    const decoder=new TextDecoder();
    while(true){
        const {value,done}=await reader.read();
        if (done) break;
        const chunk=decoder.decode(value,{stream:true})
        onChunk(chunk) //send partial text to frontend
    }
}
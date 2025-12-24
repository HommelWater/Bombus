const appName = "Chat Application";
let socket;
document.addEventListener('DOMContentLoaded', load);

function login(){
    const code = document.getElementById('login-code').value;
	const username = document.getElementById('login-username').value;
    socket.send(JSON.stringify({"type":"authenticate", "data":{"username":username, "key":code}}));
}

function message(e){
    const resp = JSON.parse(e.data);
    const type = resp.type;
    const data = resp.data;
    if (type == "signup"){
        const username = document.getElementById('login-username').value;
        generateTOTPQRCode(data.totp_secret, appName, username);
    } else
    if (type == "login"){
        localStorage.setItem("session", data.session_key);
        location.href = "/";
    } else
    if (type == "failure"){
        console.log(data.notification);
    }
}

function open(){
    const session = localStorage.getItem("session");
    if (session) location.href = "/";
}

function connectWS(){
    if((document.visibilityState === 'visible') && (!socket || (socket.readyState !== WebSocket.OPEN))){
        if (socket) socket.close();
        socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/ws`);
        socket.addEventListener('open', open);
        socket.addEventListener('close', close)
        socket.addEventListener('message', message);
    }
}

function close(){
    if (document.visibilityState === 'visible') {
        setTimeout(connectWS, 1000);
    }
}

function load(){
    connectWS();
    document.getElementById('login-button').addEventListener('click', login);
}

function generateTOTPQRCode(secret, issuer, accountName) {
    document.getElementById("login-code").innerHTML = "";
    const container = document.getElementById("qrcode");
    container.innerHTML = "";
    
    const totpUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}`;
    
    const link = document.createElement("a");
    link.href = totpUri;
    link.style.display = "inline-block";
    link.style.cursor = "pointer";
    link.style.position = "relative";
    link.title = "Click to open authenticator app";
    
    new QRCode(link, {
        text: totpUri,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
    
    container.appendChild(link);
    
    setTimeout(() => {
        const badge = document.createElement("div");
        badge.textContent = "🟢 Click to open";
        badge.style.cssText = `
            position: absolute; bottom: 5px; right: 5px;
            background: rgba(255,255,255,0.9); padding: 4px 8px;
            border-radius: 4px; font-size: 10px; pointer-events: none;
        `;
        link.appendChild(badge);
    }, 50);
    
    document.getElementById('qrcode-label').innerHTML = 
        `Scan the QR code or click to open in your authenticator app.`;
}
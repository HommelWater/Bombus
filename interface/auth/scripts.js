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
    const container = document.getElementById("qrcode");
    container.innerHTML = "";
    
    const totpUri = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}`;

    const link = document.createElement("a");
    link.href = totpUri;
    link.style.display = "inline-block";
    link.style.cursor = "pointer";
    link.title = "Click to open in authenticator app";
    
    new QRCode(link, {
        text: totpUri,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
    
    document.getElementById('qrcode-label').innerHTML = 
        `Scan the QR code or click to open in your authenticator app.`;
}

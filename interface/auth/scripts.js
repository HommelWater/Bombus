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

function load(){
    socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/ws`);
    socket.addEventListener('open', open);
    socket.addEventListener('message', message);
    document.getElementById('login-button').addEventListener('click', login);
}

function generateTOTPQRCode(secret, issuer, accountName) {
	const totpUri = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}`;
	var qrcode = new QRCode(document.getElementById("qrcode"), {
		text: totpUri,
		width: 256,
		height: 256,
		colorDark : "#000000",
		colorLight : "#ffffff",
		correctLevel : QRCode.CorrectLevel.H
	});
    document.getElementById('qrcode-label').innerHTML = "Scan the QR code with your authenticator app and use the TOTP code to log in.";
}

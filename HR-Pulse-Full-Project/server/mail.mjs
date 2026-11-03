import {connect as tlsConnect} from 'node:tls';
import {connect as tcpConnect} from 'node:net';

/* Minimal SMTP client (no dependencies): SMTPS on 465 or STARTTLS on 587, AUTH LOGIN, one PDF attachment.
   App Service settings: SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASS, MAIL_FROM (e.g. "HR Pulse <hr@cmll.in>"). */
export function mailConfig(env=process.env){
 const host=env.SMTP_HOST,port=Number(env.SMTP_PORT||465),user=env.SMTP_USER,pass=env.SMTP_PASS,from=env.MAIL_FROM||user;
 return host&&user&&pass&&from?{host,port,user,pass,from}:null;}

function dialogue(socket){
 let buffer='';const waiters=[];
 const flush=()=>{for(;;){const m=buffer.match(/^(?:\d{3}-[^\r\n]*\r\n)*(\d{3})(?: [^\r\n]*)?\r\n/);if(!m)return;buffer=buffer.slice(m[0].length);waiters.shift()?.({code:Number(m[1]),lines:m[0].split('\r\n').filter(Boolean).map(l=>l.slice(4))});}};
 socket.on('data',chunk=>{buffer+=chunk.toString();flush();});
 socket.on('error',error=>waiters.shift()?.({code:0,lines:[error.message]}));
 return {read:()=>new Promise(resolve=>waiters.push(resolve)),write:text=>socket.write(text+'\r\n')};}
async function expect(io,ok,command){if(command!==undefined)io.write(command);const reply=await io.read();if(!ok.includes(reply.code))throw Object.assign(new Error(`SMTP ${reply.code}: ${reply.lines.join(' ')}`),{status:502});return reply;}

export async function sendMail({to,subject,text,attachment},config=mailConfig()){
 if(!config)throw Object.assign(new Error('Email is not configured on the server (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM)'),{status:503});
 const {host,port,user,pass,from}=config,secure=port!==587;
 let socket=await new Promise((resolve,reject)=>{const s=(secure?tlsConnect:tcpConnect)({host,port,servername:host},()=>resolve(s));s.once('error',reject);s.setTimeout(20000,()=>s.destroy(new Error('SMTP timeout')));});
 let io=dialogue(socket);
 try{
  await expect(io,[220]);await expect(io,[250],`EHLO hrpulse`);
  if(!secure){await expect(io,[220],'STARTTLS');socket=await new Promise((resolve,reject)=>{const s=tlsConnect({socket,servername:host},()=>resolve(s));s.once('error',reject);});io=dialogue(socket);await expect(io,[250],'EHLO hrpulse');}
  await expect(io,[334],'AUTH LOGIN');await expect(io,[334],Buffer.from(user).toString('base64'));await expect(io,[235],Buffer.from(pass).toString('base64'));
  const fromAddress=from.match(/<([^>]+)>/)?.[1]||from;
  await expect(io,[250],`MAIL FROM:<${fromAddress}>`);await expect(io,[250,251],`RCPT TO:<${to}>`);await expect(io,[354],'DATA');
  const boundary='=_HRPulse_'+Date.now().toString(36),encodeHeader=v=>/[^\x20-\x7e]/.test(v)?`=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`:v;
  const message=[`From: ${from}`,`To: <${to}>`,`Subject: ${encodeHeader(subject)}`,`Date: ${new Date().toUTCString()}`,`MIME-Version: 1.0`,`Content-Type: multipart/mixed; boundary="${boundary}"`,'',
   `--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(text).toString('base64').replace(/.{76}/g,'$&\r\n'),
   ...(attachment?[`--${boundary}`,`Content-Type: ${attachment.type||'application/pdf'}; name="${attachment.name}"`,'Content-Transfer-Encoding: base64',`Content-Disposition: attachment; filename="${attachment.name}"`,'',attachment.base64.replace(/.{76}/g,'$&\r\n')]:[]),
   `--${boundary}--`,''].join('\r\n').replace(/\r\n\./g,'\r\n..');
  await expect(io,[250],message+'\r\n.');
  io.write('QUIT');}
 finally{socket.end();}}

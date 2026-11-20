export const DRIVING_VIDEO_FORMATS = [
  {mime:'video/webm;codecs=av01',extension:'webm',label:'WebM/AV1'},
  {mime:'video/webm;codecs=vp9',extension:'webm',label:'WebM/VP9'},
  {mime:'video/webm;codecs=vp8',extension:'webm',label:'WebM/VP8'},
  {mime:'video/mp4;codecs=avc1.42E01E',extension:'mp4',label:'MP4/H.264'},
  {mime:'video/mp4',extension:'mp4',label:'MP4/H.264'},
] as const;

export type DrivingVideoFormat = typeof DRIVING_VIDEO_FORMATS[number];

export function chooseDrivingVideoFormat(supported:(mime:string)=>boolean):DrivingVideoFormat|undefined {
  return DRIVING_VIDEO_FORMATS.find(format=>supported(format.mime));
}

export function optimizedDrivingVideoName(name:string,extension:string){
  return (name.replace(/\.[^.]+$/,'')||'driving-trial')+'-optimized.'+extension;
}

const waitForMetadata=(video:HTMLVideoElement,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('The selected video could not be read.'));};
  const aborted=()=>{cleanup();reject(new DOMException('Video optimization was cancelled.','AbortError'));};
  const cleanup=()=>{video.removeEventListener('loadedmetadata',done);video.removeEventListener('error',failed);signal?.removeEventListener('abort',aborted);};
  video.addEventListener('loadedmetadata',done,{once:true});
  video.addEventListener('error',failed,{once:true});
  signal?.addEventListener('abort',aborted,{once:true});
  if(video.readyState>=1)done();
});

export async function optimizeDrivingVideo(file:File,{signal,onProgress}:{signal?:AbortSignal;onProgress?:(progress:number)=>void}={}):Promise<{file:File;format:DrivingVideoFormat}>{
  if(typeof MediaRecorder==='undefined'||typeof HTMLCanvasElement.prototype.captureStream!=='function')throw new Error('Automatic video optimization is not supported by this browser. Use a current Chrome, Edge, Firefox, or Safari version.');
  const format=chooseDrivingVideoFormat(mime=>MediaRecorder.isTypeSupported(mime));
  if(!format)throw new Error('This browser cannot create AV1, VP9, or H.264 video. Update the browser and try again.');
  const source=URL.createObjectURL(file),video=document.createElement('video');
  video.src=source;video.preload='auto';video.muted=true;video.playsInline=true;
  try{
    await waitForMetadata(video,signal);
    if(!video.videoWidth||!video.videoHeight)throw new Error('The selected video has no readable picture.');
    const scale=Math.min(1,854/video.videoWidth,480/video.videoHeight),canvas=document.createElement('canvas');
    canvas.width=Math.max(2,Math.round(video.videoWidth*scale/2)*2);canvas.height=Math.max(2,Math.round(video.videoHeight*scale/2)*2);
    const context=canvas.getContext('2d',{alpha:false});if(!context)throw new Error('Video optimization could not start.');
    const stream=canvas.captureStream(15),chunks:Blob[]=[];
    const recorder=new MediaRecorder(stream,{mimeType:format.mime,videoBitsPerSecond:220_000});
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    const stopped=new Promise<void>((resolve,reject)=>{recorder.onstop=()=>resolve();recorder.onerror=()=>reject(new Error('Video optimization failed.'));});
    const duration=Math.min(Number.isFinite(video.duration)&&video.duration>0?video.duration:30,30);
    let timer:ReturnType<typeof setInterval>|undefined;
    const finished=new Promise<void>((resolve,reject)=>{
      const abort=()=>{video.pause();reject(new DOMException('Video optimization was cancelled.','AbortError'));};
      signal?.addEventListener('abort',abort,{once:true});
      timer=setInterval(()=>{
        context.drawImage(video,0,0,canvas.width,canvas.height);
        onProgress?.(Math.min(1,video.currentTime/duration));
        if(video.ended||video.currentTime>=duration){video.pause();signal?.removeEventListener('abort',abort);resolve();}
      },1000/15);
    });
    recorder.start(500);
    try{await video.play();await finished;}
    finally{if(timer)clearInterval(timer);if(recorder.state!=='inactive')recorder.stop();}
    await stopped;stream.getTracks().forEach(track=>track.stop());
    const blob=new Blob(chunks,{type:recorder.mimeType||format.mime});
    if(!blob.size)throw new Error('The optimized video was empty. Choose another video.');
    onProgress?.(1);
    return {file:new File([blob],optimizedDrivingVideoName(file.name,format.extension),{type:blob.type,lastModified:Date.now()}),format};
  }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(source);}
}

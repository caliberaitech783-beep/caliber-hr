import {describe,expect,it} from 'vitest';
import {chooseDrivingVideoFormat,optimizedDrivingVideoName} from './optimizeDrivingVideo';

describe('driving video optimization',()=>{
  it('prefers AV1, then VP9, then H.264',()=>{
    expect(chooseDrivingVideoFormat(()=>true)?.label).toBe('WebM/AV1');
    expect(chooseDrivingVideoFormat(mime=>mime.includes('vp9'))?.label).toBe('WebM/VP9');
    expect(chooseDrivingVideoFormat(mime=>mime.startsWith('video/mp4'))?.label).toBe('MP4/H.264');
  });

  it('uses an optimized filename in the selected container',()=>{
    expect(optimizedDrivingVideoName('trial.MOV','webm')).toBe('trial-optimized.webm');
    expect(optimizedDrivingVideoName('','mp4')).toBe('driving-trial-optimized.mp4');
  });
});

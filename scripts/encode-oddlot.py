"""Mux the captured UI and timed narration using ffmpeg; accepts media dir and output."""
import json, subprocess, sys
from pathlib import Path
media=Path(sys.argv[1]);output=Path(sys.argv[2]);clips=json.loads((media/'timeline.json').read_text())
inputs=['-y','-i',str(media/'walkthrough.webm')]
for clip in clips: inputs+=['-i',str(media/clip['file'])]
filters=[f"[{i+1}:a]adelay={round(c['start']*1000)}:all=1[a{i}]" for i,c in enumerate(clips)]
filters.append(''.join(f'[a{i}]' for i in range(len(clips)))+f'amix=inputs={len(clips)}:normalize=0,apad[mixed]')
subprocess.run(['ffmpeg',*inputs,'-filter_complex',';'.join(filters),'-map','0:v','-map','[mixed]','-c:v','libx264','-threads','2','-preset','fast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',str(output)],check=True)
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
output.with_suffix('.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f"{stamp(c['start'])} --> {stamp(c['start']+c['duration'])}\n{c['text']}" for c in clips)+'\n')

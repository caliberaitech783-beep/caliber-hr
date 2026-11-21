export async function combineAadhaarSides(front: File, back: File): Promise<File> {
  const images: ImageBitmap[] = [];
  try {
    for (const side of [front, back]) images.push(await createImageBitmap(side));
    const sizes = images.map(({width,height}) => {
      const scale = Math.min(1, 1800 / Math.max(width,height));
      return {width: Math.max(1,Math.round(width*scale)), height: Math.max(1,Math.round(height*scale))};
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(...sizes.map(size => size.width));
    canvas.height = sizes[0].height + sizes[1].height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = 'white';
    context.fillRect(0,0,canvas.width,canvas.height);
    let top = 0;
    images.forEach((image,index) => {
      const {width,height} = sizes[index];
      context.drawImage(image,Math.floor((canvas.width-width)/2),top,width,height);
      top += height;
    });
    const jpeg = await new Promise<Blob|null>(resolve => canvas.toBlob(resolve,'image/jpeg',0.9));
    if (!jpeg) throw new Error('Could not create Aadhaar image');
    return new File([jpeg],'aadhaar-front-and-back.jpg',{type:'image/jpeg'});
  } finally {
    images.forEach(image => image.close());
  }
}

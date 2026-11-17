// Coordinates are upper-left PDF points, matching the reviewed source regions.
export function regionScale(region) {
  regionGeometry(region,1);
  const width = region.rect[2]-region.rect[0], height = region.rect[3]-region.rect[1];
  // Bound each backing canvas for mobile Safari; CSS controls the display size.
  return Math.min(2.3,4000/width,4000/height,Math.sqrt(3_500_000/(width*height)));
}

export function regionGeometry(region, scale = 2.3) {
  if (!region || !Array.isArray(region.rect) || region.rect.length !== 4 || !region.rect.every(Number.isFinite)) throw new Error('Invalid PDF region.');
  if (!Number.isFinite(region.pageWidth) || !Number.isFinite(region.pageHeight) || region.pageWidth <= 0 || region.pageHeight <= 0) throw new Error('Invalid PDF page dimensions.');
  const [left, top, right, bottom] = region.rect;
  if (!Number.isInteger(region.page) || region.page < 1 || left < 0 || top < 0 || right <= left || bottom <= top || right > region.pageWidth + 0.01 || bottom > region.pageHeight + 0.01) throw new Error('PDF region is outside its source page.');
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('Invalid PDF render scale.');
  return {width:Math.ceil((right - left) * scale),height:Math.ceil((bottom - top) * scale),transform:[1,0,0,1,-left * scale,-top * scale]};
}

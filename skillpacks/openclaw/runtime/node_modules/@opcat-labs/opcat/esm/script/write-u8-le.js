function writeU8LE(writer, n) {
  if (n > 0xff) throw new Error('number too large');
  const buffer = new Uint8Array(1);
  buffer[0] = n;
  return writer.write(buffer);
}

export default writeU8LE;

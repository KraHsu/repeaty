/** The small subset of protobuf wire types used by Anki's package metadata. */
export function protobuf(bytes: Uint8Array): Map<number, (number | bigint | Uint8Array)[]> {
  const fields = new Map<number, (number | bigint | Uint8Array)[]>()
  let offset = 0
  function varint(): bigint {
    let value = 0n
    for (let shift = 0; shift < 70; shift += 7) {
      const byte = bytes[offset++]
      if (byte === undefined) throw new Error('Truncated protobuf')
      value += BigInt(byte & 127) << BigInt(shift)
      if (!(byte & 128)) {
        if (value > 0xffffffffffffffffn) throw new Error('Oversized protobuf integer')
        return value
      }
    }
    throw new Error('Invalid protobuf integer')
  }
  while (offset < bytes.length) {
    const tagValue = varint()
    if (tagValue > 0xffffffffn) throw new Error('Invalid protobuf tag')
    const tag = Number(tagValue),
      field = Math.floor(tag / 8),
      wire = tag % 8
    if (field < 1 || field > 536870911) throw new Error('Invalid protobuf field')
    let value: number | bigint | Uint8Array
    if (wire === 0) {
      const integer = varint()
      value = integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : integer
    } else if (wire === 2) {
      const lengthValue = varint()
      if (lengthValue > BigInt(bytes.length - offset)) throw new Error('Truncated protobuf field')
      const length = Number(lengthValue)
      value = bytes.subarray(offset, offset + length)
      offset += length
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4
      if (offset > bytes.length) throw new Error('Truncated protobuf field')
      continue
    } else throw new Error('Unsupported protobuf wire type')
    const values = fields.get(field) ?? []
    values.push(value)
    fields.set(field, values)
  }
  return fields
}
export function protoBytes(fields: ReturnType<typeof protobuf>, key: number): Uint8Array {
  const value = fields.get(key)?.at(-1)
  if (value === undefined) return new Uint8Array()
  if (!(value instanceof Uint8Array)) throw new Error('Invalid protobuf bytes')
  return value
}
export function protoNumber(fields: ReturnType<typeof protobuf>, key: number): number {
  const value = fields.get(key)?.at(-1)
  if (value === undefined) return 0
  if (typeof value !== 'number') throw new Error('Invalid protobuf number')
  return value
}
export function protoText(fields: ReturnType<typeof protobuf>, key: number): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(protoBytes(fields, key))
}

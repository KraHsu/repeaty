import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createInstance } from '@open-spaced-repetition/binding-wasm32-wasip1/workerd'
import { snapshot } from '../test/fixture'
import { train, trainingPrefixes, TRAINING_ENGINE } from './training'

describe('immutable training prefixes', () => {
  it('never trains on held-out outcomes and preserves complete earlier prefixes', () => {
    const input = snapshot(),
      before = JSON.stringify(input)
    const result = trainingPrefixes(input)
    expect(result).toHaveLength(960)
    expect(Math.max(...result.map((item) => item.ratings.length))).toBe(7)
    expect(result[5]?.ratings).toEqual(input.histories[0]?.ratings.slice(0, 7))
    expect(JSON.stringify(input)).toBe(before)
  })
  it('keeps same-day reviews as context without adding a same-day target', () => {
    const input = snapshot()
    input.histories[0]!.elapsedDays[2] = 0
    const result = trainingPrefixes(input)
    expect(result).toHaveLength(959)
    expect(result[1]?.elapsedDays).toEqual([0, 7, 0, 7])
  })
  it('rejects incomplete history, newer model versions, and insufficient history', () => {
    const input = snapshot()
    input.histories[0]!.elapsedDays[0] = 2
    expect(() => trainingPrefixes(input)).toThrow('invalid-training-history')
    expect(() => trainingPrefixes({ ...snapshot(), modelVersion: 'FSRS-7' as 'FSRS-6' })).toThrow(
      'unsupported-model',
    )
    expect(() =>
      trainingPrefixes({ ...snapshot(), histories: snapshot().histories.slice(0, 2) }),
    ).toThrow('insufficient-training-history')
  })
  it('executes the real threadless WASM optimizer and explicitly returns FSRS-6 weights', async () => {
    const bytes = await readFile(new URL('../assets/optimizer.wasm', import.meta.url))
    const instance = await createInstance(await WebAssembly.compile(bytes), {
      initialMemoryPages: 1024,
      maximumMemoryPages: 8192,
    })
    try {
      const result = await train(instance.exports, snapshot(), () => {})
      expect(result.engine).toBe(TRAINING_ENGINE)
      expect(result.weights).toHaveLength(21)
      expect(result.weights.every(Number.isFinite)).toBe(true)
      expect(new Set(result.weights).size).toBeGreaterThan(10)
    } finally {
      await instance.dispose()
    }
    expect(instance.memoryBytes).toBe(0)
  }, 20_000)
})

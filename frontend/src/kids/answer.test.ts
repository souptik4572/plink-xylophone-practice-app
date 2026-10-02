import { describe, expect, it } from 'vitest'
import { answerBlocks, toolLabel } from './answer'

describe('answerBlocks', () => {
  it('turns light markdown into paragraphs and list items with bold runs', () => {
    expect(answerBlocks('She is doing **well**.\n\n* Jingle Bells: **87%**\n- Twinkle: 85%')).toEqual([
      { kind: 'p', runs: [{ text: 'She is doing ', bold: false }, { text: 'well', bold: true }, { text: '.', bold: false }] },
      { kind: 'li', runs: [{ text: 'Jingle Bells: ', bold: false }, { text: '87%', bold: true }] },
      { kind: 'li', runs: [{ text: 'Twinkle: 85%', bold: false }] },
    ])
  })

  it('handles plain text and stray asterisks', () => {
    expect(answerBlocks('Just text')).toEqual([{ kind: 'p', runs: [{ text: 'Just text', bold: false }] }])
    expect(answerBlocks('a ** b')[0].runs.map((r) => r.text).join('')).toBe('a ** b')
  })
})

describe('toolLabel', () => {
  it('says which tool Gemma used, in words', () => {
    expect(toolLabel({ name: 'predict_song', args: { song: 'Jingle Bells' }, ok: true })).toBe('TabPFN predicted Jingle Bells')
    expect(toolLabel({ name: 'list_songs', args: {}, ok: true })).toBe('TabPFN ranked her songs')
    expect(toolLabel({ name: 'mystery', args: {}, ok: false })).toBe('mystery')
  })
})

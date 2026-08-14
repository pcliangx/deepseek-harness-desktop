import { test } from 'vitest'
import assert from 'node:assert/strict'
import { hostUrl, cliBinPath } from '../src/main/paths.ts'

test('hostUrl builds the loopback url', () => {
  assert.equal(hostUrl(3080), 'http://127.0.0.1:3080')
})

test('cliBinPath prefers the packaged resources copy', () => {
  assert.match(cliBinPath({ isPackaged: true, resourcesPath: '/App.app/Contents/Resources', devRoot: '/repo' }),
    /\/App\.app\/Contents\/Resources\/apps\/cli\/lib\/bin\.js$/)
})

test('cliBinPath falls back to the dev checkout', () => {
  assert.match(cliBinPath({ isPackaged: false, resourcesPath: '', devRoot: '/repo' }),
    /\/repo\/apps\/cli\/lib\/bin\.js$/)
})

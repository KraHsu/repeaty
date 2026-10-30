import { expect, it } from 'vitest'
import { parseXml, xmlCall } from './xml'
it('escapes untrusted secret-like text and encodes only declared credential slots', () => {
  const xml = xmlCall('wp.newPost', [1, { post_content: '{{password}} <script> & 正文' }])
  expect(xml.match(/\{\{password\}\}/g)).toHaveLength(1)
  expect(xml).toContain('&#123;&#123;password&#125;&#125; &lt;script&gt; &amp; 正文')
  expect(xml).toContain('<string>{{username}}</string>')
})
it('reads XML-RPC typed structures and rejects entities, malformed values and faults', () => {
  expect(
    parseXml(
      '<methodResponse><params><param><value><struct><member><name>post_id</name><value><int>8</int></value></member><member><name>ok</name><value><boolean>1</boolean></value></member></struct></value></param></params></methodResponse>',
    ),
  ).toEqual({ post_id: 8, ok: true })
  expect(() => parseXml('<!DOCTYPE data><methodResponse/>')).toThrow('invalid-response')
  expect(() =>
    parseXml('<methodResponse><fault><value>secret diagnostic</value></fault></methodResponse>'),
  ).toThrow('remote-xml-fault')
  expect(() =>
    parseXml(
      '<methodResponse><params><param><value><int>1.2</int></value></param></params></methodResponse>',
    ),
  ).toThrow('invalid-response')
})

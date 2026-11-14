import {createHash, timingSafeEqual} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const expiresAt = Date.parse('2026-11-14T11:07:31Z');
const batchDigest = '8076aa243f6cf73f7e2a7eabe392e4c3bdfed9af2738c8ee8c09bd16853f95b5';
const tokenDigest = Buffer.from('4f4755889381b33139ab9fb305edb1d74281252a086f61bce214b76a94aa34b2', 'hex');
const expectedSize = 14131540;
const compressedSize = 1786984;
const compressedDigest = 'f3aed79c4545dcdf1d193aade402f08cc47b5dc19f0fe7048c08b47c95f3609f';
const expectedRows = 8390;
const importer = {
  actor:'hr-approved-register-import-20261114',
  permissions:{hrDesktopAccess:['Master Configuration','Employee Master']},
};

export async function importApprovedEmployeeBatch(req, service, problem) {
  const key = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (Date.now() >= expiresAt || !key || !timingSafeEqual(createHash('sha256').update(key).digest(),tokenDigest)) {
    throw problem('Not found',404);
  }
  if (req.method !== 'POST' || req.headers.origin) throw problem('Not found',404);
  const compressed = req.headers['content-type'] === 'application/gzip';
  const requestSize = compressed ? compressedSize : expectedSize;
  if ((!compressed && req.headers['content-type'] !== 'application/json') || Number(req.headers['content-length']) !== requestSize) {
    throw problem('This request must contain the approved HR import file',400);
  }
  const chunks = [];
  let size = 0;
  const hash = createHash('sha256');
  for await (const chunk of req) {
    size += chunk.length;
    if (size > requestSize) throw problem('Invalid batch size',400);
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (size !== requestSize || hash.digest('hex') !== (compressed ? compressedDigest : batchDigest)) throw problem('Invalid batch checksum',400);
  const requestBytes = Buffer.concat(chunks);
  const bytes = compressed ? gunzipSync(requestBytes,{maxOutputLength:expectedSize}) : requestBytes;
  if (compressed && createHash('sha256').update(bytes).digest('hex') !== batchDigest) throw problem('Invalid batch checksum',400);
  const batch = JSON.parse(bytes.toString('utf8'));
  if (batch.format !== 'hr-employee-master-v1' || !Array.isArray(batch.rows) || batch.rows.length !== expectedRows) {
    throw problem('Invalid batch format',400);
  }
  const result = await service.importEmployeeMasterRegister(importer,batch.rows);
  const {total} = await service.employeeMasterRegister(importer,new URLSearchParams());
  return { ...result, verifiedBatchEntries:result.inserted+result.alreadyImported, registerTotal:total };
}

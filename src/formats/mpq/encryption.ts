export const MpqEncryptionTable = new Map<number, bigint>();

const mulA = 125n;
const addA = 3n;
const modA = 0x2AAAABn;
const modB = 0xFFFFn;
const shiftA = 0x10n;
let seed = 0x00100001n;

for (let i = 0; i < 256; i++) {
    let index = i;
    for (let j = 0; j < 5; j++) {
        seed = (seed * mulA + addA) % modA;
        const temp1 = (seed & modB) << shiftA;

        seed = (seed * mulA + addA) % modA;
        const temp2 = seed & modB;
        MpqEncryptionTable.set(index, temp1 | temp2);
        index += 0x100;
    }
}
import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
// 공식 setup: PrismaTypes와 dmmf는 pothos generator 생성물에서 (Prisma 7 조합)
import type PrismaTypes from './generated/pothos-types';
import { getDatamodel } from './generated/pothos-types';
import { prisma, type Context } from './context';

export const builder = new SchemaBuilder<{
  PrismaTypes: PrismaTypes;
  Context: Context;
}>({
  plugins: [PrismaPlugin],
  prisma: { client: prisma, dmmf: getDatamodel() },
});

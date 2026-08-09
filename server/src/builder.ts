import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
// 공식 setup: PrismaTypes와 dmmf는 pothos generator 생성물에서 (Prisma 7 조합)
import type PrismaTypes from './generated/pothos-types';
import { getDatamodel } from './generated/pothos-types';
import { prisma, type Context } from './context';

export const builder = new SchemaBuilder<{
  PrismaTypes: PrismaTypes;
  Context: Context;
}>({
  // 📚 LEARN(P6): plugin-prisma의 `t.prismaConnection`은 제네릭 조건부 타입
  // (`'relay' extends PluginName ? ... : never`, node_modules/@pothos/plugin-prisma/dts/
  // global-types.d.ts)으로 선언돼 있다 — plugins 배열의 PluginName 유니온에 'relay'가
  // 포함돼야만 이 필드 자체가 타입상 존재한다. relay: {}는 EmptyToOptional 유틸리티 타입
  // 덕분에 가능 — RelayPluginOptions의 필수처럼 보이는 필드들(nodeTypeOptions 등)이 전부
  // 구조적으로 {}와 호환되는 Omit<...optional...> 타입이라 전체가 옵셔널로 접힌다.
  plugins: [PrismaPlugin, RelayPlugin],
  prisma: { client: prisma, dmmf: getDatamodel() },
  relay: {},
});

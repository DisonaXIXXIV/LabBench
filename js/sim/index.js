// Реестр моделей электропривода. Чтобы подключить полноценную
// электромеханическую модель, добавьте её класс сюда и выберите по умолчанию.
import { QuasiStaticModel } from './model.js';

export const MODELS = {
  quasistatic: QuasiStaticModel,
  // electromech: ElectroMechModel,  // TODO: модель уравнений машин/преобразователей
};

export const DEFAULT_MODEL = 'quasistatic';

export function createModel(bench, name = DEFAULT_MODEL) {
  const Cls = MODELS[name] || MODELS[DEFAULT_MODEL];
  return new Cls(bench);
}

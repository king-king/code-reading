import { STRICT, WHITESPACES } from '../helpers/constants';

import Symbol from 'core-js-pure/es/symbol';
import trimLeft from 'core-js-pure/es/string/trim-left';
import trimStart from 'core-js-pure/es/string/trim-start';

QUnit.test('String#trimLeft', assert => {
  assert.isFunction(trimLeft);
  assert.same(trimLeft(' \n  q w e \n  '), 'q w e \n  ', 'removes whitespaces at left side of string');
  assert.same(trimLeft(WHITESPACES), '', 'removes all whitespaces');
  assert.same(trimLeft('\u200B\u0085'), '\u200B\u0085', "shouldn't remove this symbols");

  assert.throws(() => trimLeft(Symbol()), 'throws on symbol context');

  if (STRICT) {
    assert.throws(() => trimLeft(null, 0), TypeError);
    assert.throws(() => trimLeft(undefined, 0), TypeError);
  }
});

QUnit.test('String#trimStart', assert => {
  assert.isFunction(trimStart);
  assert.same(trimStart(' \n  q w e \n  '), 'q w e \n  ', 'removes whitespaces at left side of string');
  assert.same(trimStart(WHITESPACES), '', 'removes all whitespaces');
  assert.same(trimStart('\u200B\u0085'), '\u200B\u0085', "shouldn't remove this symbols");

  assert.throws(() => trimStart(Symbol()), 'throws on symbol context');

  if (STRICT) {
    assert.throws(() => trimStart(null, 0), TypeError);
    assert.throws(() => trimStart(undefined, 0), TypeError);
  }
});

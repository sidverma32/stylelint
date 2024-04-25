import valueParser from 'postcss-value-parser';

import {
	isValueFunction as isFunction,
	isValueSpace as isSpace,
	isValueWord as isWord,
} from '../../utils/typeGuards.mjs';
import { assert } from '../../utils/validateTypes.mjs';
import declarationValueIndex from '../../utils/declarationValueIndex.mjs';
import getDeclarationValue from '../../utils/getDeclarationValue.mjs';
import isStandardSyntaxValue from '../../utils/isStandardSyntaxValue.mjs';
import report from '../../utils/report.mjs';
import ruleMessages from '../../utils/ruleMessages.mjs';
import setDeclarationValue from '../../utils/setDeclarationValue.mjs';
import { singleArgumentMathFunctions } from '../../reference/functions.mjs';
import validateOptions from '../../utils/validateOptions.mjs';

const ruleName = 'function-calc-no-unspaced-operator';

const messages = ruleMessages(ruleName, {
	expectedBefore: (operator) => `Expected single space before "${operator}" operator`,
	expectedAfter: (operator) => `Expected single space after "${operator}" operator`,
	expectedOperatorBeforeSign: (operator) => `Expected an operator before sign "${operator}"`,
});

const meta = {
	url: 'https://stylelint.io/user-guide/rules/function-calc-no-unspaced-operator',
	fixable: true,
};

const OPERATORS = new Set(['+', '-']);
const OPERATOR_REGEX = /[+-]/;
const ALL_OPERATORS = new Set([...OPERATORS, '*', '/']);
// #7618
const alternatives = [...singleArgumentMathFunctions].join('|');
const FUNC_NAMES_REGEX = new RegExp(`^(?:${alternatives})$`, 'i');
const FUNC_CALLS_REGEX = new RegExp(`(?:${alternatives})\\(`, 'i');

/** @type {import('stylelint').Rule} */
const rule = (primary, _secondaryOptions, context) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, { actual: primary });

		if (!validOptions) return;

		/**
		 * @param {string} message
		 * @param {import('postcss').Node} node
		 * @param {number} index
		 * @param {string} operator
		 */
		function complain(message, node, index, operator) {
			const endIndex = index + operator.length;

			report({ message, node, index, endIndex, result, ruleName });
		}

		root.walkDecls((decl) => {
			const value = getDeclarationValue(decl);

			if (!OPERATOR_REGEX.test(value)) return;

			if (!FUNC_CALLS_REGEX.test(value)) return;

			let needsFix = false;
			const valueIndex = declarationValueIndex(decl);

			/**
			 * @param {import('postcss-value-parser').WordNode} operatorNode
			 * @param {import('postcss-value-parser').SpaceNode} spaceNode
			 * @param {'before' | 'after'} position
			 * @returns {void}
			 */
			function checkSpaceAroundOperator(operatorNode, spaceNode, position) {
				const indexOfFirstNewLine = spaceNode.value.search(/(\n|\r\n)/);

				if (indexOfFirstNewLine === 0) return;

				if (context.fix) {
					needsFix = true;
					spaceNode.value =
						indexOfFirstNewLine === -1 ? ' ' : spaceNode.value.slice(indexOfFirstNewLine);

					return;
				}

				const operator = operatorNode.value;
				const operatorSourceIndex = operatorNode.sourceIndex;

				const message =
					position === 'before'
						? messages.expectedBefore(operator)
						: messages.expectedAfter(operator);

				complain(message, decl, valueIndex + operatorSourceIndex, operator);
			}

			/**
			 * @param {import('postcss-value-parser').Node[]} nodes
			 * @returns {boolean}
			 */
			function checkForOperatorInFirstNode(nodes) {
				const [firstNode] = nodes;

				assert(firstNode);

				if (!isWord(firstNode)) return false;

				if (!isStandardSyntaxValue(firstNode.value)) return false;

				const operatorIndex = firstNode.value.search(OPERATOR_REGEX);

				if (operatorIndex <= 0) return false;

				const operator = firstNode.value.charAt(operatorIndex);
				const charBefore = firstNode.value.charAt(operatorIndex - 1);
				const charAfter = firstNode.value.charAt(operatorIndex + 1);

				if (charBefore && charBefore !== ' ' && charAfter && charAfter !== ' ') {
					if (context.fix) {
						needsFix = true;
						firstNode.value = insertCharAtIndex(firstNode.value, operatorIndex + 1, ' ');
						firstNode.value = insertCharAtIndex(firstNode.value, operatorIndex, ' ');
					} else {
						complain(
							messages.expectedBefore(operator),
							decl,
							valueIndex + firstNode.sourceIndex + operatorIndex,
							operator,
						);
						complain(
							messages.expectedAfter(operator),
							decl,
							valueIndex + firstNode.sourceIndex + operatorIndex + 1,
							operator,
						);
					}
				} else if (charBefore && charBefore !== ' ') {
					if (context.fix) {
						needsFix = true;
						firstNode.value = insertCharAtIndex(firstNode.value, operatorIndex, ' ');
					} else {
						complain(
							messages.expectedBefore(operator),
							decl,
							valueIndex + firstNode.sourceIndex + operatorIndex,
							operator,
						);
					}
				}

				return true;
			}

			/**
			 * @param {import('postcss-value-parser').Node[]} nodes
			 * @returns {boolean}
			 */
			function checkForOperatorInLastNode(nodes) {
				if (nodes.length === 1) return false;

				const lastNode = nodes.at(-1);

				assert(lastNode);

				if (!isWord(lastNode)) return false;

				const operatorIndex = lastNode.value.search(OPERATOR_REGEX);

				if (operatorIndex === -1) return false;

				// E.g. "10px * -2" when the last node is "-2"
				if (isOperator(nodes.at(-3), ALL_OPERATORS) && isSingleSpace(nodes.at(-2))) {
					return false;
				}

				if (context.fix) {
					needsFix = true;
					lastNode.value = insertCharAtIndex(lastNode.value, operatorIndex + 1, ' ').trim();
					lastNode.value = insertCharAtIndex(lastNode.value, operatorIndex, ' ').trim();

					return true;
				}

				const operator = lastNode.value.charAt(operatorIndex);

				complain(
					messages.expectedOperatorBeforeSign(operator),
					decl,
					valueIndex + lastNode.sourceIndex + operatorIndex,
					operator,
				);

				return true;
			}

			const parsedValue = valueParser(value);

			parsedValue.walk((node) => {
				if (!isFunction(node) || !FUNC_NAMES_REGEX.test(node.value)) return;

				const { nodes } = node;

				let foundOperatorNode = false;

				for (const [nodeIndex, operatorNode] of nodes.entries()) {
					if (!isOperator(operatorNode)) continue;

					foundOperatorNode = true;

					const nodeBefore = nodes[nodeIndex - 1];
					const nodeAfter = nodes[nodeIndex + 1];

					if (nodeBefore && isSpace(nodeBefore) && nodeBefore.value !== ' ') {
						checkSpaceAroundOperator(operatorNode, nodeBefore, 'before');
					}

					if (nodeAfter && isSpace(nodeAfter) && nodeAfter.value !== ' ') {
						checkSpaceAroundOperator(operatorNode, nodeAfter, 'after');
					}
				}

				if (!foundOperatorNode) {
					checkForOperatorInFirstNode(nodes) || checkForOperatorInLastNode(nodes);
				}
			});

			if (needsFix) {
				setDeclarationValue(decl, parsedValue.toString());
			}
		});
	};
};

/**
 * @param {string} str
 * @param {number} index
 * @param {string} char
 */
function insertCharAtIndex(str, index, char) {
	return str.slice(0, index) + char + str.slice(index, str.length);
}

/**
 * @param {import('postcss-value-parser').Node | undefined} node
 * @returns {node is import('postcss-value-parser').SpaceNode}
 */
function isSingleSpace(node) {
	return node != null && isSpace(node) && node.value === ' ';
}

/**
 * @param {import('postcss-value-parser').Node | undefined} node
 * @param {Set<string>} [operators]
 * @returns {node is import('postcss-value-parser').WordNode}
 */
function isOperator(node, operators = OPERATORS) {
	return node != null && isWord(node) && operators.has(node.value);
}

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;
export default rule;

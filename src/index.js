import {version} from "../package.json";
import jsonstat from "./jsonstat.js";

const responseJSON = resp => {
	if(!resp.ok){
		throw new Error(`${resp.status} ${resp.statusText}`);
	}
	return resp.json();
}

//1.4.0 typedArray
/**
 * Creates a JSONstat dataset from tabular row data.
 * @param {string[]} columns - Column names
 * @param {Array[]} rows - Array of row arrays (values in same order as columns)
 * @param {Object} options - { measures: string[], timeDimensions?: string[] }
 * @returns {jsonstat} A dataset instance
 */
function fromRows(columns, rows, options) {
	const
		measures = options && options.measures ? options.measures : [],
		timeDims = options && options.timeDimensions ? options.timeDimensions : [],
		numMeasures = measures.length
	;

	// Pre-built column index map: column name → integer index in each row
	const colIndexMap = new Map();
	for (let i = 0; i < columns.length; i++) {
		colIndexMap.set(columns[i], i);
	}

	// Set-based measure lookup for O(1) filtering
	const measureSet = new Set(measures);

	// Identify dimension columns (non-measure columns, preserving order)
	const dimCols = [];
	for (let i = 0; i < columns.length; i++) {
		if (!measureSet.has(columns[i])) {
			dimCols.push(columns[i]);
		}
	}
	const numDims = dimCols.length;

	// Pre-compute column indices for dimension columns
	const dimColIndices = new Int32Array(numDims);
	for (let i = 0; i < numDims; i++) {
		dimColIndices[i] = colIndexMap.get(dimCols[i]);
	}

	// Pre-compute column indices for measure columns
	const measureColIndices = new Int32Array(numMeasures);
	for (let i = 0; i < numMeasures; i++) {
		measureColIndices[i] = colIndexMap.get(measures[i]);
	}

	// Single-pass category discovery: ordered arrays + Map<value, index> per dimension
	const dimCatArrays = new Array(numDims);   // string[][] — ordered categories
	const dimCatMaps = new Array(numDims);     // Map<string, int>[] — value → index
	for (let i = 0; i < numDims; i++) {
		dimCatArrays[i] = [];
		dimCatMaps[i] = new Map();
	}

	const numRows = rows.length;
	for (let r = 0; r < numRows; r++) {
		const row = rows[r];
		for (let d = 0; d < numDims; d++) {
			const val = String(row[dimColIndices[d]]);
			if (!dimCatMaps[d].has(val)) {
				dimCatMaps[d].set(val, dimCatArrays[d].length);
				dimCatArrays[d].push(val);
			}
		}
	}

	// Build ids and size arrays
	const ids = new Array(numDims + (numMeasures > 0 ? 1 : 0));
	const size = new Array(ids.length);
	for (let i = 0; i < numDims; i++) {
		ids[i] = dimCols[i];
		size[i] = dimCatArrays[i].length;
	}
	if (numMeasures > 0) {
		ids[numDims] = "metric";
		size[numDims] = numMeasures;
	}

	// Compute strides for sparse value placement
	// stride[lastDim] = numMeasures (or 1 if no measures), stride[i] = stride[i+1] * size[i+1]
	const strides = new Array(numDims);
	if (numDims > 0) {
		strides[numDims - 1] = numMeasures > 0 ? numMeasures : 1;
		for (let i = numDims - 2; i >= 0; i--) {
			strides[i] = strides[i + 1] * size[i + 1];
		}
	}

	// Total observations
	let totalCells = 1;
	for (let i = 0; i < size.length; i++) {
		totalCells *= size[i];
	}

	// Pre-allocate value array with null
	const value = new Array(totalCells).fill(null);

	// Sparse value placement: O(numRows × numDims) + O(numRows × numMeasures)
	for (let r = 0; r < numRows; r++) {
		const row = rows[r];

		// Compute flat offset from dimension coordinates via stride multiplication
		let offset = 0;
		for (let d = 0; d < numDims; d++) {
			const val = String(row[dimColIndices[d]]);
			offset += dimCatMaps[d].get(val) * strides[d];
		}

		// Place each measure value at offset + measureIdx
		if (numMeasures > 0) {
			for (let m = 0; m < numMeasures; m++) {
				value[offset + m] = row[measureColIndices[m]];
			}
		}
	}

	// Build dimension metadata objects
	const dimension = {};
	for (let i = 0; i < numDims; i++) {
		const cats = dimCatArrays[i];
		const catIndex = {};
		const catLabel = {};
		for (let j = 0; j < cats.length; j++) {
			catIndex[cats[j]] = j;
			catLabel[cats[j]] = cats[j];
		}
		dimension[dimCols[i]] = {
			category: { index: catIndex, label: catLabel }
		};
	}

	if (numMeasures > 0) {
		const metricIndex = {};
		const metricLabel = {};
		for (let i = 0; i < numMeasures; i++) {
			metricIndex[measures[i]] = i;
			metricLabel[measures[i]] = measures[i];
		}
		dimension["metric"] = {
			category: { index: metricIndex, label: metricLabel }
		};
	}

	// Build role object
	const role = { metric: numMeasures > 0 ? ["metric"] : null };
	if (timeDims.length > 0) {
		const idSet = new Set(ids);
		const timeRoles = [];
		for (let i = 0; i < timeDims.length; i++) {
			if (idSet.has(timeDims[i])) timeRoles.push(timeDims[i]);
		}
		role.time = timeRoles.length > 0 ? timeRoles : null;
	}

	return new jsonstat({
		version: "2.0",
		class: "dataset",
		id: ids,
		size: size,
		dimension: dimension,
		role: role,
		value: value
	});
}

export default function JSONstat(input, init, typedArray) {
	const options=(typeof init==="object") ? init : { method: "GET" };

	if(typeof typedArray!=="function"){
		typedArray=null;
	}

	if(!typedArray && typeof init==="function"){
		typedArray=init;
	}

	if(typeof input==="object"){
		return new jsonstat(input, typedArray);
	}else{
		if(input==="version"){
			return version;
		}else if(fetch){
			return fetch(input, options)
				.then(responseJSON)
				.then(json => new jsonstat(json, typedArray))
				.catch(err => {
					throw err;
				});
		}
	}
}

JSONstat.fromRows = fromRows;

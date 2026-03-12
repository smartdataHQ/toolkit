const
	//1.4.0
	isTypedArray = s => Object.prototype.toString.call(s.buffer) === "[object ArrayBuffer]",
	isValidTypedArrayName = name => {
		const names=[
			"Int8Array",
			"Uint8Array",
			"Uint8ClampedArray",
			"Int16Array",
			"Uint16Array",
			"Int32Array",
			"Uint32Array",
			"Float32Array",
			"Float64Array",
			"BigInt64Array",
			"BigUint64Array"
		];

		return names.includes(name);
	}
;

function jsonstat(o, typedArray){
	const
		//sparse cube (value or status)
		//If only one value/status is provided it means same for all (if more than one, then missing values/statuses are nulled).
		normalize = (s, len, ta) => {
			//1.5.0 [], {} (when empty, it can only be {})
			if(Object.entries(s).length===0){
				return null;
			}

			let ret=[], l;

			if(ta && !isValidTypedArrayName(ta.name)){
				ta=null;
			}

			if(typeof s==="string"){
				s=[s];
			}
			if(//Array or TypedArray
				Array.isArray(s) ||
				isTypedArray(s) //1.4.0
			){
				if(s.length===len){ //normal case
					//1.4.0 (1.4.1 don't convert to TypedArray if nulls (or empty or undefined) are present)
					return ta && -1===s.findIndex(d => d===null || typeof d==="undefined") ? ta.from(s) : s;
				}
				if(s.length===1){ //all obs same status
					return Array(len).fill(s[0]);
				}
			}

			//It's an object (sparse cube) or an incomplete array that must be filled with nulls
			ret = new Array(len).fill(null);
			const keys = Object.keys(s);
			for (l = 0; l < keys.length; l++) {
				const k = Number(keys[l]);
				if (k < len) ret[k] = s[keys[l]];
			}
			return ret;
		},
		//For native dimension responses
		dimSize = cat => {
			const c=( typeof cat.index==="undefined" ) ? cat.label : cat.index;
			return ( Array.isArray(c) ) ? c.length : Object.keys(c).length;
		}
	;

	let ot, prop;

	this.length=0;
	this.id=[];

	if (o===null || typeof o==="undefined"){
		return;
	}

	this.class=o.class || "bundle";
	switch(this.class){
		case "bundle" : //Real bundle, or URL (bundle, dataset, collection, dimension), or error
			this.error=null;
			this.length=0;

			// Wrong input object
			if(o===null || typeof o!=="object"){
				this.class=null;
				return;
			}

			// Explicit error
			if(o.hasOwnProperty("error")){
				this.error=o.error;
				return;
			}

			//When o is a URI, class won't be set before the request
			//and it will enter the bundle case: once we have a response
			//if class is dataset we redirect to case "dataset". 0.7.5
			if(o.class==="dataset" || o.class==="collection" || o.class==="dimension"){
				return new jsonstat(o);
			}

			const arr = Object.keys(o);

			this.__tree__=o;
			this.length=arr.length;
			this.id=arr;
		break;

		case "dataset" :
			//It's a native response of class "dataset"
			this.__tree__=ot=o.hasOwnProperty("__tree__") ? o.__tree__ : o;
			this.label=ot.label || null;
			this.note=ot.note || null; //v.0.7.0
			this.link=ot.link || null; //v.0.7.0
			this.href=ot.href || null; //v.0.7.0
			this.updated=ot.updated || null;
			this.source=ot.source || null; //v.0.5.0
			this.extension=ot.extension || null; //v.0.7.0

			//Sparse cube (If toTable() removed, this logic can be moved inside Data()
			//which is more efficient when retrieving a single value/status.
			let dsize=0; //data size

			const size=ot.size || (ot.dimension && ot.dimension.size); //0.9.0 (JSON-stat 2.0)

			this.size=size; //0.10.0

			//1.2.7 No value, null, [] => same as {} (metadata response)
			this.value=(!ot.hasOwnProperty("value") || ot.value===null || ot.value.length===0) ? {} : ot.value;

			dsize = (Array.isArray(this.value) || isTypedArray(this.value)) ? this.value.length : size.reduce((acc, curr) => acc * curr, 1);

			this.value=normalize(this.value, dsize, typedArray);
			//1.5.3 ot.status===null (when it comes from Dice() for example)
			this.status=(!(ot.hasOwnProperty("status")) || ot.status===null) ? null : normalize(ot.status, dsize);

			// if dimensions are defined, id and size arrays are required and must have equal length
			if(ot.hasOwnProperty("dimension")){
				const
					otd=ot.dimension,
					otr=ot.role || (!ot.version && otd.role) || null, //0.9.0 (JSON-stat 2.0) - Added check for version 0.9.1: role only valid on dimension if no version
					otdi=ot.id || otd.id, //0.9.0 (JSON-stat 2.0)
					otdl=size.length,
					createRole = s => {
						if(!otr.hasOwnProperty(s)){
							otr[s]=null;
						}
					}
				;

				if (
					!(Array.isArray(otdi)) ||
					!(Array.isArray(size)) ||
					otdi.length!=otdl
					){
					return;
				}

				this.length=otdl;
				this.id=otdi;

				if(otr){
					createRole("time");
					createRole("geo");
					createRole("metric");
					createRole("classification");
				}

				//If role not null, leave it as it is but add a classification role if it's null. Added in 0.7.1
				if (otr && otr.classification===null){
					let gmt=[];
					for(const role of ["time","geo","metric"]){
						const rr=otr[role];
						if(rr!==null){
							gmt=gmt.concat(rr);
						}
					}

					const classification = otdi.filter(id => !gmt.includes(id));
					otr.classification = classification.length ? classification : null;
				}

				this.role=otr;

				this.n=dsize; //number of obs added in 0.4.2

				//If only one category, no need of index according to the spec
				//This actually will recreate an index even if there are more than one category and no index is provided
				//but because there's no guarantee that properties are retrieved in a particular order (even though it worked in Ch,FF,IE,Sa,Op)
				//(Main problem in fact is that you don't have to WRITE them in a particular order) the original order of categories could
				//theoretically be changed. That's why the procedure will only be valid when there's only one category.
				//Note: If toTable() is removed it would make more sense to move this loop inside Dimension() as it is not needed for Data().
				for(let d=0, len=this.length; d<len; d++){
					if (!(otd[otdi[d]].category.hasOwnProperty("index"))){
						let c=0;
						otd[otdi[d]].category.index={};
						for (prop in otd[otdi[d]].category.label){
							otd[otdi[d]].category.index[prop]=c++;
						}
					}else{
						// If index is array instead of object convert into object
						// That is: we normalize it (instead of defining a function depending on
						// index type to read categories -maybe in the future when indexOf can be
						// assumed for all browsers and default is array instead of object-)
						if(Array.isArray(otd[otdi[d]].category.index)){
							const oindex={}, index=otd[otdi[d]].category.index;

							index.forEach((key, i) => {
								oindex[key] = i;
							});
							otd[otdi[d]].category.index=oindex;
						}
					}
				}
			}else{
				this.length=0;
			}
		break;

		case "dimension" :
			//It's a native response of class "dimension"
			if( !o.hasOwnProperty("__tree__") ){
				return new jsonstat({
						"version": "2.0",
						"class": "dataset",
						"dimension": {
							d: o
						},
						"id": ["d"],
						"size": [ dimSize(o.category) ],
						"value": [ null ]
					}).Dimension(0)
				;
			}

			ot=o.__tree__;
			const cats=[], otc=ot.category;
			if(
				!ot.hasOwnProperty("category") //Already tested in the Dimension() / Category() ? method
				){
				return;
			}

			//If no category label, use IDs
			if(!otc.hasOwnProperty("label")){
				otc.label={};
				for (prop in otc.index){
					otc.label[prop]=prop;
				}
			}

			//Array conversion
			for (prop in otc.index){
				cats[otc.index[prop]]=prop; //0.4.3 cats.push(prop) won't do because order not in control when index was originally an array and was converted to object by the Toolkit.
			}

			this.__tree__=ot;
			//When no dimension label, undefined is returned.
			//Discarded options: null / dim
			this.label=ot.label || null;
			this.note=ot.note || null; //v.0.7.0
			this.link=ot.link || null; //v.0.7.0
			this.href=ot.href || null; //v.0.7.0
			this.id=cats;
			this.length=cats.length;
			this.role=o.role;
			this.hierarchy=otc.hasOwnProperty("child"); //0.6.0
			this.extension=ot.extension || null; //v.0.7.0
		break;

		case "category" :
			const par=o.child;

			//0.5.0 changed. It was autoreference: id. And length was 0 always
			this.id=par;
			this.length=(par===null) ? 0 : par.length;

			this.index=o.index;
			this.label=o.label;
			this.note=o.note || null; //v.0.7.0

			this.unit=o.unit; //v.0.5.0
			this.coordinates=o.coord; //v.0.5.0
		break;

		case "collection" : //0.8.0
			this.length=0;
			this.label=o.label || null;
			this.note=o.note || null;
			this.link=o.link || null;
			this.href=o.href || null;
			this.updated=o.updated || null;
			this.source=o.source || null;
			this.extension=o.extension || null;

			if(this.link!==null && o.link.item){
				const item=o.link.item;

				this.length=( Array.isArray(item) ) ? item.length : 0;
				if(this.length){
					this.id = item.map(i => i.href);
				}
			}
		break;
	}
}

jsonstat.prototype.Item=function(o){ //0.8.0
	if (this===null || this.class!=="collection" || !this.length){
		return null;
	}

	if(typeof o==="number"){
		if(o>this.length || o<0){
			return null;
		}
		return this.link.item[o];
	}

	// If o is not a valid object, return all items
	if (typeof o !== 'object' || o === null) {
		return this.link.item;
	}

	if(!o.class){
		return null;
	}

	//Is object with class property: filter by class
	//0.8.3: {class: "dataset"} or {class: "dataset", embedded: true/false}

	// Use filter to declaratively find the items
	return this.link.item.filter(item => {
		// Condition 1: Class must match
		if (item.class !== o.class) {
			return false;
		}

		// Condition 2: Handle the special "embedded" dataset case
		// 0.9.3 Embedded currently only valid with datasets (and JSON-stat 2.0)
		if (o.class === "dataset" && typeof o.embedded === "boolean") {
			const isEmbedded = item.id && item.size && item.dimension; //it looks like a full embedded dataset vs dataset reference only
			return o.embedded ? isEmbedded : !isEmbedded;
		}

		// If we're here, the class matched and it wasn't the special case, so include it
		return true;
	});
};

jsonstat.prototype.Dataset=function(ds){
	if(this===null){
		return null;
	}

	//0.8.1 Dataset responses can be treated as bundle ones
	if(this.class==="dataset"){
		return (typeof ds!=="undefined") ? this : [this];
	}

	//0.9.3 Dataset collections can be managed as old bundles if they are embedded
	if(this.class==="collection"){
		const dscol=this.Item({"class": "dataset", "embedded": true});

		if(typeof ds==="undefined"){
			return dscol.map(d => new jsonstat(d));
		}

		//Dataset(2) means the 3rd embedded dataset in the collection
		if(typeof ds==="number" && ds>=0 && ds<dscol.length){
			return new jsonstat(dscol[ds]);
		}

		//Dataset("https://...") selection by ID (href) for generalization's sake (probably not particularly useful) 0.9.9
		if(typeof ds==="string"){
			const found = dscol.find(item => item.href === ds);
			if (found) {
				return new jsonstat(found);
			}
		}

		return null;
	}

	if(this.class!=="bundle"){
		return null;
	}

	if(typeof ds==="undefined"){
		return this.id.map(id => this.Dataset(id));
	}
	if(typeof ds==="number"){
		const num=this.id[ds];
		return (typeof num!=="undefined") ? this.Dataset(num) : null;
	}

	const tds=this.__tree__[ds];
	if(typeof tds==="undefined"){
		return null;
	}

	return new jsonstat({"class" : "dataset", "__tree__": tds});
};

jsonstat.prototype.Dimension=function(dim, bool){
	bool=(typeof bool==="boolean") ? bool : true; //0.12.2

	const
		role = (otr,dim) => { //0.9.0 (JSON-stat 2.0)
			if(otr!==null){
				for(let prop in otr){
					for(let p=(otr[prop]!==null ? otr[prop].length : 0); p--;){
						if(otr[prop][p]===dim){
							return prop;
						}
					}
				}
			}
			return null;
		}
	;

	if (this===null || this.class!=="dataset"){
		return null;
	}
	if(typeof dim==="undefined"){
		return this.id.map(id => this.Dimension(id));
	}
	if(typeof dim==="number"){
		const num=this.id[dim];
		return (typeof num!=="undefined") ? this.Dimension(num, bool) : null;
	}

	const otr=this.role;

	//currently only "role" is supported as filter criterion
	if(typeof dim==="object"){
		if(dim.hasOwnProperty("role")){
			const ar = [];
			for(let c=0, len=this.id.length; c<len; c++){
				const oid=this.id[c];
				if(role(otr,oid)===dim.role){
					ar.push(this.Dimension(oid, bool));
				}
			}
			return (typeof ar[0]==="undefined") ? null : ar;
		}else{
			return null;
		}
	}

	const otd=this.__tree__.dimension;
	if(typeof otd==="undefined"){
		return null;
	}

	const otdd=otd[dim];
	if(typeof otdd==="undefined"){
		return null;
	}

	if(!bool){ //0.12.2
		return ((index, label) => {
			let labels=[];
			for(let prop in index){
				labels[index[prop]]=label[prop];
			}
			return labels;
		})(otdd.category.index, otdd.category.label);
	}

	return new jsonstat({"class" : "dimension", "__tree__": otdd, "role": role(otr,dim)});
};

jsonstat.prototype.Category=function(cat){
	if (this===null || this.class!=="dimension"){
		return null;
	}
	if(typeof cat==="undefined"){
		return this.id.map(id => this.Category(id));
	}
	if(typeof cat==="number"){
		const num=this.id[cat];
		return (typeof num!=="undefined") ? this.Category(num) : null;
	}

	const oc=this.__tree__.category;
	if(typeof oc==="undefined"){
		return null;
	}
	const index=oc.index[cat];
	if(typeof index==="undefined"){
		return null;
	}

	const
		unit=(oc.unit && oc.unit[cat]) || null,
		coord=(oc.coordinates && oc.coordinates[cat]) || null,
		child=(oc.child && oc.child[cat]) || null,
		note=(oc.note && oc.note[cat]) || null
	;
	return new jsonstat({"class" : "category", "index": index, "label": oc.label[cat], "note": note, "child" : child, "unit" : unit, "coord" : coord});
};


//Since v.1.1.0 (more powerful than Slice)
//Supports 1.1 (filters, clone, drop) Deprecated
//Supports 1.2 (filters, options)
//options={clone: false, drop: false, stringify: false, ovalue: false, ostatus: false}
jsonstat.prototype.Dice=function(filters, options, drop){
	let
		clone,
		stringify,
		ovalue,
		ostatus
	;
	const
		boolize = (opt, par) => opt.hasOwnProperty(par) && !!opt[par],
		toTypedArray = (value, constructor) => constructor.from(value)
	;

	if(this===null || this.class!=="dataset"
		//1.5.1
		|| this.value===null
	){
		return null;
	}
	if(typeof filters!=="object"){
		return this;
	}

	if(typeof options!=="object"){
		//Old style (v.1.1)
		if(typeof options==="boolean" && options===true){
			clone=true;
		}
		if(typeof drop!=="boolean" || drop!==true){
			drop=false;
		}
	}else{ //1.2+ (options object)
		clone=boolize(options, "clone");
		drop=boolize(options, "drop");
		stringify=boolize(options, "stringify");
		ovalue=boolize(options, "ovalue");
		ostatus=boolize(options, "ostatus");
	}

	let	
		tree,
		value=[],
		status=[]
	;

	const
		originalValue=this.value,
		ds=clone ? new jsonstat(structuredClone(this)) : this,
		statin=ds.status,
		objectify = filters => {
			const obj = {};
			filters.forEach(f => {
				obj[f[0]] = f[1];
			});
			return obj;
		},
		keep = drop => {
			const obj = {};
			Object.keys(drop)
				.forEach(d => {
					obj[d] = ds.Dimension(d).id.filter(cat => drop[d].indexOf(cat) === -1);
				});
			return obj;
		},
		arr2obj = (o, p) => {
			const ret = {};
			if (Array.isArray(o[p])){
				o[p].forEach((e, i) => {
					if (e !== null){
						ret[String(i)] = e;
					}
				});
				return ret;
			}
			return o[p];
		},
		modify = (tree, attr) => {
			const newcont = arr2obj(tree, attr);
			delete tree[attr];
			tree[attr] = newcont;
		}
	;

	//Accept arrays [["area", ["BE","ES"]],["year", ["2010","2011"]]]
	if(Array.isArray(filters)){
		filters=objectify(filters);
	}

	//filters are not required. {} and [] accepted but also null
	if(filters===null){
		filters={};
	}

	const ids=Object.keys(filters);

	//If there are filters... (with or without filters value and status are returned as arrays)
	if(ids.length>0){
		//category values must be inside array
		ids.forEach(dim => {
			const d = filters[dim];
			if (!Array.isArray(d)){
				filters[dim] = [d];
			}

			if (filters[dim].length === 0){
				delete filters[dim];
			}
		});

		if(drop){
			filters=keep(filters);
		}

		// Build filter Sets for O(1) lookup instead of indexOf
		const filterSets = {};
		ids.forEach(dimid => {
			filterSets[dimid] = new Set(filters[dimid]);
		});

		// Direct iteration via Unflatten instead of materializing full Transform
		ds.Unflatten((coordinates, datapoint) => {
			for (let fi = 0; fi < ids.length; fi++) {
				if (!filterSets[ids[fi]].has(coordinates[ids[fi]])) {
					return; // skip — AND condition failed
				}
			}
			value.push(datapoint.value);
			status.push(datapoint.status);
		});

		ids.forEach(dimid => {
			const 
				ids = ds.Dimension(dimid).id,
				index = {}
			;
			let ndx = 0;

			ds.size[ds.id.indexOf(dimid)] = filters[dimid].length;

			ids.forEach(catid => {
				if (filters[dimid].indexOf(catid) !== -1){
					index[catid] = ndx;
					ndx++;
				}
			});

			ds.__tree__.dimension[dimid].category.index = index;
		});

		ds.n=value.length;

		//1.4.0 Support for TypedArrays
		ds.value=ds.__tree__.value=isTypedArray(originalValue) ? toTypedArray(value, originalValue.constructor) : value;
		ds.status=ds.__tree__.status=(statin!==null) ? status : null;
	}

	if(stringify){
		tree=ds.__tree__;

		//if v<2.0 convert to 2.0
		if(!tree.hasOwnProperty("id")){
			tree.version="2.0";
			if(!tree.hasOwnProperty("class")){
				tree.class="dataset";
			}

			tree.id=tree.dimension.id;
			tree.size=tree.dimension.size;
			delete tree.dimension.id;
			delete tree.dimension.size;

			if(tree.dimension.hasOwnProperty("role")){
				tree.role=tree.dimension.role;
				delete tree.dimension.role;
			}
		}

		if(tree.hasOwnProperty("status") && ["null", "{}", "[]"].indexOf(JSON.stringify(tree.status))!==-1){
			delete tree.status;
		}

		if(tree.hasOwnProperty("role")){
			delete tree.role.classification;

			["geo", "time", "metric"].forEach(e => {
				if (tree.role[e] === null){
					delete tree.role[e];
				}
			});
		}

		if(ovalue){
			modify(tree, "value");
		}
		if(ostatus && tree.hasOwnProperty("status")){
			modify(tree, "status");
		}

		return JSON.stringify(tree);
	}

	return ds;
};

//Deprecated since v.1.1
jsonstat.prototype.Slice=function(filter){
	if(this===null || this.class!=="dataset"
		//1.5.0
		|| Object.entries(this.value).length===0
	){
		return null;
	}
	if(typeof filter==="undefined"){
		return this;
	}

	//Convert {"gender": "M" } into [ ["gender", "M"] ]
	if(!Array.isArray(filter)){
		filter = Object.keys(filter).map(p => [p, filter[p]]);
	}

	return this.Dice(
		filter.map(e => [ e[0], [e[1]] ])
	);
};

jsonstat.prototype.Data=function(e, include){
	let
		i, ret=[], len,
		firstprop = o => {
			for (let p in o) {
				if(o.hasOwnProperty(p)){
					return p;
				}
			}
		},
		// Cache for single-category dimension first properties
		_singleCatCache = {},
		dimObj2Array = (thisds, sel, type) => {
			let
				a=[], i, obj={}
			;
			const
				dim=thisds.dimension,
				di=thisds.id || dim.id, //0.9.2 (JSON-stat 2.0)
				dsize=thisds.size || (dim && dim.size) //0.9.2 (JSON-stat 2.0)
			;

			//Convert [["gender", "T"],["birth", "T"]] into {gender: "T", birth: "T"}
			if(type==="array"){
				for(i=sel.length;i--;){
					obj[sel[i][0]]=sel[i][1];
				}
				sel=obj;
			}

			for (let d=0, len=di.length; d<len; d++){
				const id=di[d], cat=sel[id];
				//If dimension not defined and dim size=1, take first category (user not forced to specify single cat dimensions)
				if(typeof cat==="string"){
					a.push(cat);
				}else if(dsize[d]===1){
					if(!(id in _singleCatCache)){
						_singleCatCache[id]=firstprop(dim[id].category.index);
					}
					a.push(_singleCatCache[id]);
				}else{
					a.push(null);
				}
			}

			return a;
		}
	;

	if(this===null || this.class!=="dataset"
		//1.5.1
		|| this.value===null
	){
		return null;
	}

	if(typeof e==="undefined"){
		//Before 0.4.2
		//return {"value" : this.value, "status": this.status, "label": tree.label, "length" : this.value.length};
		//Since 0.4.2: normalized as array of objects
		return this.value.map((_, i) => this.Data(i));
	}

	//Since 0.10.1 status can be excluded. Default: true (=include status)
	if(typeof include!=="boolean"){
		include=true;
	}

	//Data By Position in original array
	if(typeof e==="number"){
		const num=this.value[e];

		if(typeof num==="undefined"){
			return null;
		}

		if(include){
			return { "value" : num, "status": (this.status) ? this.status[e] : null };
		}else{
			return num;
		}
	}

	let type="object"; //default. If e is an array of arrays, type="array"
	const 
		tree=this.__tree__,
		n=tree.size || (tree.dimension && tree.dimension.size), //0.9.2 (JSON-stat 2.0)
		dims=n.length//same as this.length
	;

	if(Array.isArray(e)){
		//DataByPosition in every dim
		//If more positions than needed are provided, they will be ignored.
		//Less positions than needed will return undefined
		if(!Array.isArray(e[0])){
			if(this.length!==e.length){
				return null;
			}
			let
				mult=1,
				res=0,
				miss=[],
				nmiss=[]
			;
			//Validate dim index
			//And loop to find missing dimensions
			for(i=0; i<dims; i++){
				if(typeof e[i]!=="undefined"){
					if(typeof e[i]!=="number" || e[i]>=n[i]){
						return null;
					}
					//Used if normal case (miss.length===0)
					mult*=(i>0) ? n[(dims-i)] : 1;
					res+=mult*e[dims-i-1]; //simplified in 0.4.3
				}else{
					//Used if missing dimensions miss.length>0
					miss.push(i); //missing dims
					nmiss.push(n[i]); //missing dims size
				}
			}

			//If all dims are specified, go ahead as usual.
			//If one non-single dimension is missing create array of results
			//If more than one non-single dimension is missing, WARNING
			if(miss.length>1){
				return null;
			}
			if(miss.length===1){
				for(let c=0, clen=nmiss[0]; c<clen; c++){
					let na=[]; //New array
					for(i=0; i<dims; i++){
						if(i!==miss[0]){
							na.push(e[i]);
						}else{
							na.push(c);
						}
					}
					ret.push(this.Data(na, include));
				}
				return ret;
			}

			if(include){
				return {"value" : this.value[res], "status": (this.status) ? this.status[res] : null};
			}else{
				return this.value[res];
			}

		}else{
			//If array but not array of numbers, array of arrays is assumed
			//[ ["gender", "M"], ["year", "2011"] ]
			type="array";
		}
	}

	let pos=[];
	const 
		id=dimObj2Array(tree, e, type), //Object { gender: "M", year: "2011" }
		otd=tree.dimension,
		otdi=tree.id || otd.id //0.9.2 (JSON-stat 2.0)
	;

	for(i=0, len=id.length; i<len; i++){
		pos.push(otd[otdi[i]].category.index[id[i]]);
	}

	//Dimension cat undefined means a loop (by position) is necessary
	return this.Data(pos, include);
};

/*
	Transformation method: output in DataTable format (array or object)
	Deprecated: Planned for removal in 3.0.0
	Setup: opts={by: null, bylabel: false, meta: false, drop: [], status: false, slabel: "Status", vlabel: "Value", field: "label", content: "label", type: "array"} (type values: "array" / "object" / "arrobj" / "objarr"[1.4.0])
*/
jsonstat.prototype.toTable=function(opts, func){
	if(this===null || this.class!=="dataset"
		//1.5.1
		|| this.value===null
	){
		return null;
	}

	if(arguments.length==1 && typeof opts==="function"){
		func=opts;
		opts=null;
	}

	//default: use label for field names and content instead of "id". "by", "prefix", drop & meta added on 0.13.0 (currently only for "arrobj"/"objarr", "by" cancels "unit"). "comma" is 0.13.2
	opts=opts || {field: "label", content: "label", vlabel: "Value", slabel: "Status", type: "array", status: false, unit: false, by: null, prefix: "", drop: [], meta: false, comma: false, bylabel: false};

	const prefix=(typeof opts.prefix!=="undefined") ? opts.prefix : "";

	//1.3.0 Backward compatibility: before arrobj had always field=id (now it's the default)
	if((opts.type==="arrobj" || opts.type==="objarr") && typeof(opts.field)==="undefined"){
		opts.field="id";
	}

	let totbl, i, j, x, len;
	const
	 	useid=(opts.field==="id"),
		getVlabel = str => (useid && "value") || str || "Value",
		getSlabel = str => (useid && "status") || str || "Status",
		dataset=this.__tree__
	;

	let 
		status=(opts.status===true) //0.13.1: be as strict as "meta": allow only booleans
	;

	if(typeof func==="function"){
		totbl=this.toTable(opts);
		let ret=[];
		const
			start=(opts.type!=="array") ? 0 : 1, //first row is header in array and object
			arr=(opts.type!=="object") ? totbl.slice(start) : totbl.rows.slice(0)
		;

		len=arr.length;
		for(i=0; i<len; i++){
			const a=func.call(
				this, //0.5.3
				arr[i], //Discarded for efficiency: (opts.type!=='object') ? arr[i] : arr[i].c,
				i
			);
			if(typeof a!=="undefined"){
				ret.push(a);
			}
		}
		if(opts.type==='object'){
			return {cols: totbl.cols, rows: ret};
		}
		if(opts.type==='array'){
			ret.unshift(totbl[0]);
		}
		return ret;
	}

	if(opts.type==="arrobj" || opts.type==="objarr"){
		let
			tbl=[],
			addUnits=function(){},
			metriclabels={}
		;

		const 
			//0.12.3
			metric=dataset.role && dataset.role.metric,
			//0.13.0 "by" is ignored if it's not an existing dimension ID
			ds=this,
			ids=ds.id,
			by=(opts.by && ids.indexOf(opts.by)!==-1) ? opts.by : null,
			meta=(opts.meta===true),
			drop=(typeof opts.drop!=="undefined" && Array.isArray(opts.drop)) ? opts.drop : [],
			comma=(opts.comma===true),
			bylabel=(opts.bylabel===true),
			ta=ds.value.constructor,
			formatResp = arr => {
				//1.4.0 columns arrays ("objarr") simple (vs. efficient) implementation: converted from "arrobj"
				//For example: value array in a column array is equal to the original normalized JSON-stat value array
				const vlabel=getVlabel(opts.vlabel);
				let
					obj={},
					arrobj2objarr
				;

				if(opts.type==="objarr"){
					arrobj2objarr=
						(by===null && isValidTypedArrayName(ta.name))
						?
						e => {
							if(e===vlabel){
								obj[e]=ta.from(arr, d => d[e]);
							}else{
								obj[e]=arr.map(d => d[e]);
							}
						}
						:
						e => {
							obj[e]=arr.map(d => d[e]);
						}
					;

					Object.keys(arr[0]).forEach(arrobj2objarr);
					arr=obj;
				}

				if(meta){
					obj={};

					ids.forEach(i => {
						const d=ds.Dimension(i);

						obj[i]={
							"label": d.label,
							"role": d.role,
							"categories": { //diferent from JSON-stat on purpose: "id" is not "index" and "label" is different than JSON-stat categories' label.
								"id": d.id,
								"label": ds.Dimension(i, false)
							}
						};
					});

					return {
						"meta": {
							"label": ds.label,
							"source": ds.source,
							"updated": ds.updated,

							//0.13.1
							"id": ids,
							"status": status,
							"unit": opts.unit,
							"by": by,
							"bylabel": bylabel,
							"drop": by!==null && drop.length>0 ? drop : null,
							"prefix": by!==null ? (prefix || "") : null,
							//0.13.2
							"comma": comma,

							"dimensions": obj //different from JSON-stat on purpose: the content is different and this export format is addressed to people probably not familiar with the JSON-stat format
						},
						"data": arr
					};
				}else{
					//does nothing
					return arr;
				}
			}
		;

		//1.3.0 If by, opts.fields forced to "id"
		if(by){
			opts.field="id";
		}

		totbl=this.toTable({field: opts.field /* Before 1.3.0 was: "id" */, vlabel: opts.vlabel, slabel: opts.slabel, content: opts.content, status: status});

		const head=totbl.shift();
		let tblr;

		//0.12.3 Include unit information if there's any (only if arrobj/objarr and 0.13.0 not "by")
		if(by===null && opts.unit && metric){
			if(opts.content!=="id"){
				for(let m=metric.length; m--;){
					const mdim=this.Dimension(metric[m]);
					metriclabels[metric[m]]={};

					for(let mm=mdim.length; mm--;){
						metriclabels[metric[m]][mdim.Category(mm).label]=mdim.id[mm];
					}
				}
			}

			addUnits=function(d, c){
				//array indexOf
				if(metric.indexOf(d)!==-1){
					const cat=dataset.dimension[d].category;
					/*0.13.9*/
					if(cat.unit){
						tblr.unit=cat.unit[opts.content!=="id" ? metriclabels[d][c] : c];
					}else{
						tblr.unit=null; /*when units requested but missing in the dataset, create "unit" property too*/
					}
				}
			};

			opts.unit=true; //normalized
		}else{
			opts.unit=false;
		}

		len=totbl.length;
		for(i=0; i<len; i++){ //Can't be done with i-- as we want to keep the original order
			tblr={};
			for(j=totbl[i].length;j--;){
				tblr[head[j]]=totbl[i][j];
				addUnits(head[j], totbl[i][j]); //0.12.3
			}
			tbl.push(tblr);
		}

		//0.13.2
		if(comma){
			const vlabel=getVlabel(opts.vlabel); //2.0.3
			tbl.forEach(function(r){
				if(r[vlabel]!==null){
					r[vlabel]=(String(r[vlabel])).replace(".", ",");
				}
			});
		}

		//0.13.0
		//Categories' IDs of "by" dimension will be used as object properties: user can use "prefix" to avoid conflict with non-by dimensions' IDs
		if(by!==null){
			const
				save={},
				labelid={}
			;
			let
				arr=[],
				assignValue
			;

			drop.forEach(function(id, i){
				//remove incorrect ids & ids for dimensions with size>1 from the drop array
				if( !ds.Dimension(id) || ds.Dimension(id).length>1 ){
					drop[i]="";
				}
			});

			const
				noby=ids.filter(function(i) {
					return i!==by && drop.indexOf(i)===-1;
				}),
				byDim=ds.Dimension(by),
				setId=function(row, noby){
					let a=[];

					noby.forEach(function(e){
						a.push(row[e]);
					});

					return a.join("\t");
				},
				setObj=function(row, noby){
					const obj={};

					noby.forEach(function(e){
						obj[e]=row[e];
					});

					return obj;
				}
			;

			if(opts.content!=="id"){
				//0.13.3
				if(bylabel){
					assignValue=function(save, id, row){
						save[id][ `${prefix}${row[by]}` ]=row.value;
					}
				}else{
					byDim.Category().forEach(function(c, i){
						labelid[c.label]=byDim.id[i];
					});

					assignValue=function(save, id, row){
						save[id][ `${prefix}${labelid[row[by]]}` ]=row.value;
					}
				}
			}else{
				assignValue=function(save, id, row){
					save[id][ `${prefix}${row[by]}` ]=row.value;
				}
			}

			tbl.forEach(function(row){
				const id=setId(row, noby);

				if(typeof save[id]==="undefined"){
					save[id]=setObj(row, noby);
				}

				//We use a conditionally defined function to avoid an "if" inside the loop.
				assignValue(save, id, row, by);
			});

			for(let prop in save){
				arr.push(save[prop]);
			}

			status=false; //Incompatible with "by"
			return formatResp(arr);
		}

		return formatResp(tbl);
	}

	let
		addCol,
		addColValue,
		addRow,
		addRowValue,
		row=[]
	;

	if(opts.type==="object"){
		//Object
		const valuetype=(typeof this.value[0]==="number" || this.value[0]===null) ? "number" : "string"; //cell type inferred from first cell. If null, number is assumed (naif)

		addCol=function(dimid, dimlabel){
			const label=(useid && dimid) || dimlabel || dimid; //if useid then id; else label; then id if not label
			cols.push({id: dimid, label: label, type: "string"}); //currently not using datetime Google type (requires a Date object)
		};

		addColValue=function(str1, str2, status){
			const
				vlabel=getVlabel(str1),
				slabel=getSlabel(str2)
			;
			if(status){
				cols.push({id: "status", label: slabel, type: "string"});
			}
			cols.push({id: "value", label: vlabel, type: valuetype});
		};

		addRow=function(r){
			row.push({v: r});
		};

		addRowValue=function(r){
			//At the moment, no support for formatted values (f: formatted)
			row.push({v: r});
			rows.push({c: row});
		};

	}else{
		//Array
		addCol=function(dimid,dimlabel){
			const colid=(useid && dimid) || dimlabel || dimid; //if useid then id; else label; then id if not label
			cols.push(colid);
		};

		addColValue=function(str1,str2,status){
			const
				vlabel=getVlabel(str1),
				slabel=getSlabel(str2)
			;
			if(status){
				cols.push(slabel);
			}
			cols.push(vlabel);
			table.push(cols);
		};

		addRow=function(r){
			row.push(r);
		};

		addRowValue=function(r){
			row.push(r);
			table.push(row);
		};
	}

	const
		dd=dataset.dimension,
		ddi=dataset.id || dd.id, //0.9.5 (JSON-stat 2.0)
		dds=dataset.size || dd.size, //0.9.5 (JSON-stat 2.0)
		ddil=ddi.length
	;

	if (ddil!=dds.length){
		return false;
	}

	let dim=[], total=1, m=1, mult=[], dimexp=[], label=[], table=[], cols=[], rows=[];

	for (i=0; i<ddil; i++){
		const
			dimid=ddi[i],
			dimlabel=dd[dimid].label
		;

		addCol(dimid,dimlabel); //Global cols

		total*=dds[i];
		m*=dds[i];
		const cat=new Array(dds[i]);
		// Build position-to-id reverse lookup to avoid O(n^2) inner loop
		const catIndex=dd[ddi[i]].category.index;
		const posToId=new Array(dds[i]);
		const catLabel=dd[ddi[i]].category.label;
		const useLabel=(opts.content!=="id" && catLabel);
		for (let catid in catIndex){
			posToId[catIndex[catid]]=catid;
		}
		for (j=0; j<dds[i]; j++){
			const catid=posToId[j];
			cat[j]=useLabel ? catLabel[catid] : catid;
		}
		dim.push(cat);
		mult.push(m);
	}
	addColValue(opts.vlabel,opts.slabel,status); //Global cols and table

	// Pre-compute divisors for modular arithmetic (replaces repFactor)
	len=dim.length;
	const divisors=new Array(len);
	let div=1;
	for (i=len-1; i>=0; i--){
		divisors[i]=div;
		div*=dds[i];
	}
	// Cache dim sizes for inner loop
	const dimSizes=new Array(len);
	for (i=0; i<len; i++){
		dimSizes[i]=dim[i].length;
	}

	const valueArr=this.value;
	const statusArr=this.status;

	for (x=0; x<total; x++){
		row=[];
		for (let d=0; d<len; d++){
			addRow(dim[d][(x / divisors[d] | 0) % dimSizes[d]]); //Global row
		}
		if(status){
			addRow(
				statusArr ? statusArr[x] : null
			);
		}
		addRowValue(valueArr[x]); //Global row, rows and table
	}

	if(opts.type==="object"){
		return {cols: cols, rows: rows};
	}else{
		return table;
	}
};

jsonstat.prototype.node=function(){
	return this.__tree__;
};

jsonstat.prototype.toString=function(){
	return this.class;
};

//1.6.0 (Improved in 2.0.2)
jsonstat.prototype.Unflatten = function (callback) {
	if (this === null || this.class !== "dataset" || this.value === null || typeof callback !== 'function') {
		return null;
	}

	const
		dims = this.id,
		size = this.size,
		ndims = dims.length,
		n = this.n,
		value = this.value,
		status = this.status,
		cells = [],
		dimCats = new Array(ndims)
	;

	// Pre-compute divisors for modular arithmetic (avoids counter increment/reset)
	// For dimension i: catIndex = Math.floor(flatIndex / divisor[i]) % size[i]
	const divisors = new Array(ndims);
	let divisor = 1;
	for (let i = ndims - 1; i >= 0; i--) {
		divisors[i] = divisor;
		divisor *= size[i];
		dimCats[i] = this.Dimension(i).id;
	}

	for (let index = 0; index < n; index++) {
		const coord = {};

		for (let i = 0; i < ndims; i++) {
			coord[dims[i]] = dimCats[i][(index / divisors[i] | 0) % size[i]];
		}

		const result = callback(
			coord,
			{
				value: value[index],
				status: status ? status[index] : null
			},
			index,
			cells
		);

		if (typeof result !== 'undefined') {
			cells.push(result);
		}
	}

	return cells;
};

/* 
	2.2.0 (support for "object" type added in 2.2.1)
	Replacement for toTable().
	Comparison with toTable:
	- "unit" and callback argument not supported. 
	- "bylabel" removed (it uses "content" value instead). 
	+ "type" added to meta property ("unit" and "bylabel" removed from meta property).
	+ "drop" does not require "by".
	+ "drop" generalized (available also for "array" and "object" types)
	+ "comma" and "meta" also available for "array" type.
	+ It relies on Unflatten: much more efficient than toTable.
*/
jsonstat.prototype.Transform=function(opts){
	if (this === null || this.class !== "dataset" || this.value === null) {
		return null;
	}

	if (typeof opts !== "undefined" && opts !== null) {
		if (typeof opts !== "object" || (typeof opts.type !== "undefined" && typeof opts.type !== "string")) {
			return null;
		}
	} else {
		opts = {};
	}

	if((opts.type==="arrobj" || opts.type==="objarr") && typeof(opts.field)==="undefined"){
		opts.field="id";
	}

	const
		ds = this,
		type = opts.type !== "arrobj" && opts.type !== "objarr" && opts.type !== "object" ? "array" : opts.type,
		ids = ds.id,
		by = (type !== "array" && type !== "object" && opts.by && ids.includes(opts.by)) ? opts.by : null,
		comma = opts.comma || false,
		status = by === null && opts.status || false,
		content = opts.content || "label",
		field = by === null ? opts.field || "label" : "id",
		vlabel = opts.field === "id" ? "value" : (opts.vlabel || "Value"),
		slabel = opts.field === "id" ? "status" : (opts.slabel || "Status"),
		meta = opts.meta || false,
		prefix = (by && typeof opts.prefix === "string") ? opts.prefix : "",
		drop = Array.isArray(opts.drop) ? opts.drop.filter(id => {
			const d = ds.Dimension(id);
			return d && d.length === 1;
		}) : [],
		validIds = ids.filter(id => !drop.includes(id)),
		// Helper for single value formatting
		dot2comma = v => (v === null ? null : String(v).replace(".", ",")),
		fmt = comma ? dot2comma : (v => v)
	;

	// Pre-build integer-indexed label arrays: labelArrays[dimIdx][catIdx] → label string
	// Also cache dimension category ID arrays as flat indexed structures
	const
		nValid = validIds.length,
		dimCatIds = new Array(nValid),  // dimCatIds[i] = array of category IDs for validIds[i]
		labelArrays = (content === "label") ? new Array(nValid) : null
	;

	for (let i = 0; i < nValid; i++) {
		const
			dimId = validIds[i],
			dim = ds.Dimension(dimId),
			catIds = dim.id
		;
		dimCatIds[i] = catIds;
		if (labelArrays) {
			const catLabels = dim.__tree__.category.label;
			if (catLabels) {
				// Build flat integer-indexed array: labelArrays[i][catIdx] = label
				const arr = new Array(catIds.length);
				for (let j = 0, jlen = catIds.length; j < jlen; j++) {
					arr[j] = catLabels[catIds[j]];
				}
				labelArrays[i] = arr;
			} else {
				labelArrays[i] = null;
			}
		}
	}

	// Pre-compute dimension index positions within full dataset for modular arithmetic
	// Map from validIds index to position in ds.id
	const
		allSize = ds.size,
		ndims = ids.length,
		n = ds.n,
		value = ds.value,
		dsStatus = ds.status
	;

	// Build divisors for ALL dimensions (needed for coordinate computation)
	const allDivisors = new Array(ndims);
	let divisor = 1;
	for (let i = ndims - 1; i >= 0; i--) {
		allDivisors[i] = divisor;
		divisor *= allSize[i];
	}

	// Map validIds to their indices in the full dimension array
	const validDimIndices = new Array(nValid);
	for (let i = 0; i < nValid; i++) {
		validDimIndices[i] = ids.indexOf(validIds[i]);
	}

	// Pre-compute divisors and sizes for valid dimensions only
	const validDivisors = new Array(nValid);
	const validSizes = new Array(nValid);
	for (let i = 0; i < nValid; i++) {
		const idx = validDimIndices[i];
		validDivisors[i] = allDivisors[idx];
		validSizes[i] = allSize[idx];
	}

	// Helper: get label for dimension i, category index catIdx
	// Uses integer-indexed arrays for O(1) lookup
	const getLabel = labelArrays
		? (i, catIdx) => (labelArrays[i] ? labelArrays[i][catIdx] : dimCatIds[i][catIdx])
		: (i, catIdx) => dimCatIds[i][catIdx]
	;

	let header, unflattened;

	switch (type) {
		case "array": {
			const
				dimLabels = (field === "label") ? validIds.map(id => ds.Dimension(id).label) : validIds,
				labels = status ? [slabel, vlabel] : [vlabel]
			;

			header = dimLabels.concat(labels);

			// Inline iteration — avoid Unflatten callback overhead
			const rows = new Array(n);
			for (let index = 0; index < n; index++) {
				const ret = new Array(nValid + (status ? 2 : 1));

				for (let i = 0; i < nValid; i++) {
					const catIdx = (index / validDivisors[i] | 0) % validSizes[i];
					ret[i] = getLabel(i, catIdx);
				}

				if (status) {
					ret[nValid] = dsStatus ? dsStatus[index] : null;
					ret[nValid + 1] = fmt(value[index]);
				} else {
					ret[nValid] = fmt(value[index]);
				}

				rows[index] = ret;
			}

			unflattened = rows;
			break;
		}

		case "object": {
			const
				valuetype = (typeof value[0] === "number" || value[0] === null) ? "number" : "string",
				cols = new Array(nValid + (status ? 2 : 1))
			;

			for (let i = 0; i < nValid; i++) {
				const
					dimId = validIds[i],
					dim = ds.Dimension(dimId),
					colLabel = field === "id" ? dimId : (dim.label || dimId)
				;
				cols[i] = { id: dimId, label: colLabel, type: "string" };
			}

			let colIdx = nValid;
			if (status) {
				cols[colIdx++] = { id: "status", label: slabel, type: "string" };
			}
			cols[colIdx] = { id: "value", label: vlabel, type: valuetype };

			// Inline iteration
			const rows = new Array(n);
			for (let index = 0; index < n; index++) {
				const row = new Array(nValid + (status ? 2 : 1));

				for (let i = 0; i < nValid; i++) {
					const catIdx = (index / validDivisors[i] | 0) % validSizes[i];
					row[i] = { v: getLabel(i, catIdx) };
				}

				let ri = nValid;
				if (status) {
					row[ri++] = { v: dsStatus ? dsStatus[index] : null };
				}
				row[ri] = { v: value[index] };

				rows[index] = { c: row };
			}

			return { cols: cols, rows: rows };
		}

		case "objarr": {
			const
				// Helper for array formatting
				dec = comma ? (v => v.map(dot2comma)) : (v => v),
				getField = field === "id" ? id => id : id => ds.Dimension(id).label,
				result = {}
			;

			// Build a map from validIds index to field name (cached, not computed per cell)
			const fieldNames = new Array(nValid);
			for (let i = 0; i < nValid; i++) {
				fieldNames[i] = getField(validIds[i]);
			}

			if (by) {
				const
					byFullIdx = ids.indexOf(by),
					byDivisor = allDivisors[byFullIdx],
					bySize = allSize[byFullIdx],
					otherIndices = [], // indices into validIds that are NOT the by dimension
					otherFieldNames = [],
					byDim = ds.Dimension(by),
					rowMap = new Map(),
					catToKey = new Array(bySize) // integer-indexed: catIdx → result key
				;

				for (let i = 0; i < nValid; i++) {
					if (validIds[i] !== by) {
						otherIndices.push(i);
						otherFieldNames.push(fieldNames[i]);
					}
				}
				const nOther = otherIndices.length;

				// Initialize columns for non-pivoted dimensions
				for (let i = 0; i < nOther; i++) {
					result[otherFieldNames[i]] = [];
				}

				// Initialize columns for pivoted values
				const catKeys = new Array(bySize);
				for (let j = 0; j < bySize; j++) {
					const catId = byDim.id[j];
					const key = prefix + (field === "id" ? catId : byDim.Category(catId).label);
					catKeys[j] = key;
					catToKey[j] = key;
					result[key] = [];
				}

				let rowIndex = 0;

				// Inline iteration
				for (let index = 0; index < n; index++) {
					// Build row key from other dimensions
					let rowKey = "";
					for (let i = 0; i < nOther; i++) {
						const oi = otherIndices[i];
						const catIdx = (index / validDivisors[oi] | 0) % validSizes[oi];
						if (i > 0) rowKey += "\0";
						rowKey += dimCatIds[oi][catIdx];
					}

					let idx;
					if (rowMap.has(rowKey)) {
						idx = rowMap.get(rowKey);
					} else {
						idx = rowIndex++;
						rowMap.set(rowKey, idx);

						// Fill metadata columns
						for (let i = 0; i < nOther; i++) {
							const oi = otherIndices[i];
							const catIdx = (index / validDivisors[oi] | 0) % validSizes[oi];
							result[otherFieldNames[i]].push(getLabel(oi, catIdx));
						}

						// Initialize all value columns with null
						for (let j = 0; j < bySize; j++) {
							result[catKeys[j]].push(null);
						}
					}

					// Assign value
					const byCatIdx = (index / byDivisor | 0) % bySize;
					const val = value[index];
					if (val !== null) {
						result[catToKey[byCatIdx]][idx] = fmt(val);
					}
				}
			} else {
				// Standard behavior
				if (status) {
					result[vlabel] = dec(ds.value);
					result[slabel] = ds.status;
				} else {
					result[vlabel] = dec(ds.value);
				}

				for (let i = 0; i < nValid; i++) {
					result[fieldNames[i]] = new Array(n);
				}

				// Inline iteration
				for (let index = 0; index < n; index++) {
					for (let i = 0; i < nValid; i++) {
						const catIdx = (index / validDivisors[i] | 0) % validSizes[i];
						result[fieldNames[i]][index] = getLabel(i, catIdx);
					}
				}
			}

			unflattened = result;
			break;
		}

		//case "arrobj"
		default: {
			const
				pivotMap = by ? new Map() : null,
				validDims = new Array(nValid)
			;

			for (let i = 0; i < nValid; i++) {
				const
					dimId = validIds[i],
					dim = ds.Dimension(dimId)
				;
				validDims[i] = {
					prop: (field === "label") ? dim.label : dimId,
					isBy: (by && dimId === by)
				};
			}

			const addStatusObj = status ? (ret, s) => { ret[slabel] = s; } : () => { };

			if (by) {
				// Pivot mode: inline iteration
				const cells = [];

				for (let index = 0; index < n; index++) {
					const ret = {};
					let pivotColValue;

					for (let i = 0; i < nValid; i++) {
						const
							catIdx = (index / validDivisors[i] | 0) % validSizes[i],
							val = getLabel(i, catIdx)
						;

						if (validDims[i].isBy) {
							pivotColValue = val;
						} else {
							ret[validDims[i].prop] = val;
						}
					}

					addStatusObj(ret, dsStatus ? dsStatus[index] : null);

					const signature = Object.values(ret).join('|');

					let targetRow = pivotMap.get(signature);
					let isNew = false;

					if (!targetRow) {
						targetRow = ret;
						pivotMap.set(signature, targetRow);
						isNew = true;
					}

					targetRow[prefix + pivotColValue] = fmt(value[index]);

					if (isNew) {
						cells.push(targetRow);
					}
				}

				unflattened = cells;
			} else {
				// Non-pivot mode: inline iteration, pre-allocate array
				const cells = new Array(n);

				for (let index = 0; index < n; index++) {
					const ret = {};

					for (let i = 0; i < nValid; i++) {
						const catIdx = (index / validDivisors[i] | 0) % validSizes[i];
						ret[validDims[i].prop] = getLabel(i, catIdx);
					}

					ret[vlabel] = fmt(value[index]);
					addStatusObj(ret, dsStatus ? dsStatus[index] : null);

					cells[index] = ret;
				}

				unflattened = cells;
			}
		}
	}

	if (header) {
		unflattened.unshift(header);
	}

	if (meta) {
		const obj = {};

		ids.forEach(i => {
			const d = ds.Dimension(i);

			obj[i] = {
				"label": d.label,
				"role": d.role,
				"categories": { //diferent from JSON-stat on purpose: "id" is not "index" and "label" is different than JSON-stat categories' label.
					"id": d.id,
					"label": ds.Dimension(i, false)
				}
			};
		});

		return {
			"meta": {
				"type": type, //New in Transform. bylabel removed.
				"label": ds.label,
				"source": ds.source,
				"updated": ds.updated,
				"id": ids,
				"status": status,
				"by": by,
				"drop": drop.length > 0 ? drop : null,
				"prefix": by !== null ? (prefix || "") : null,
				"comma": comma,
				"dimensions": obj //different from JSON-stat on purpose: the content is different and this export format is addressed to people probably not familiar with the JSON-stat format
			},
			"data": unflattened
		};
	} else {
		//does nothing
		return unflattened;
	}
};

/**
 * Export the dataset as a CSV string.
 * Uses modular arithmetic over dimension sizes — no intermediate table.
 * @param {Object} [opts] - { delimiter: string (default ","), header: boolean (default true) }
 * @returns {string|null} CSV string
 */
jsonstat.prototype.toCSV = function (opts) {
	if (this === null || this.class !== "dataset" || this.value === null) {
		return null;
	}

	opts = opts || {};
	const
		delim = opts.delimiter || ",",
		includeHeader = opts.header !== false,
		dims = this.id,
		size = this.size,
		ndims = dims.length,
		n = this.n,
		value = this.value,
		dimCats = new Array(ndims)
	;

	// Pre-compute divisors for modular arithmetic
	const divisors = new Array(ndims);
	let divisor = 1;
	for (let i = ndims - 1; i >= 0; i--) {
		divisors[i] = divisor;
		divisor *= size[i];
		dimCats[i] = this.Dimension(i).id;
	}

	// Pre-allocate lines array
	const lines = new Array(includeHeader ? n + 1 : n);
	let lineIdx = 0;

	// Header
	if (includeHeader) {
		lines[lineIdx++] = dims.concat("value").join(delim);
	}

	// Data rows — use modular arithmetic, build string directly
	for (let index = 0; index < n; index++) {
		let line = dimCats[0][(index / divisors[0] | 0) % size[0]];

		for (let i = 1; i < ndims; i++) {
			line += delim + dimCats[i][(index / divisors[i] | 0) % size[i]];
		}

		line += delim + value[index];
		lines[lineIdx++] = line;
	}

	return lines.join("\n");
};

/**
 * Returns a generator that yields one row-object per observation.
 * Each object has dimension IDs as keys (with category IDs as values)
 * plus "value" and "status".
 * @returns {Generator}
 */
jsonstat.prototype.unflattenIterator = function* () {
	if (this === null || this.class !== "dataset" || this.value === null) {
		return;
	}

	const
		dims = this.id,
		size = this.size,
		ndims = dims.length,
		n = this.n,
		value = this.value,
		status = this.status,
		dimCats = new Array(ndims)
	;

	// Pre-compute divisors for modular arithmetic
	const divisors = new Array(ndims);
	let divisor = 1;
	for (let i = ndims - 1; i >= 0; i--) {
		divisors[i] = divisor;
		divisor *= size[i];
		dimCats[i] = this.Dimension(i).id;
	}

	for (let index = 0; index < n; index++) {
		const row = {};

		for (let i = 0; i < ndims; i++) {
			row[dims[i]] = dimCats[i][(index / divisors[i] | 0) % size[i]];
		}

		row.value = value[index];
		row.status = status ? status[index] : null;

		yield row;
	}
};

export default jsonstat;

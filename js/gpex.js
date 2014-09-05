
/*
 * Called onLoad. Intercept form submission; handle file locally.
 */
var setup = function() {
	Messages.msgdiv = document.getElementById('messages');
	var jscad = new OpenJsCad.Processor(document.getElementById('display'), {
		color: [0, 0.6, 0.1],
		openJsCadPath: "js/",
		viewerwidth: "800px",
		viewerheight: "400px",
		bgColor: [0.553, 0.686, 0.8, 1]// [0.769, 0.851, 0.58, 1]// [0.745, 0.902, 0.745, 1]// [0.6, 0.6, 1, 1]
	});
	var form = document.forms.namedItem('gpxform');
	form.addEventListener('submit', function(ev) {
		ev.preventDefault();
		loader(document.getElementById('gpxfile').files[0], jscad);
	}, false);
}

var Messages = {
	msgdiv: null,
	
	clear: function() {
		this.msgdiv.innerHTML = "";
		this.msgdiv.className = "";
	},
	
	error: function(message) {
		this.msgdiv.innerHTML = message;
		this.msgdiv.className = "errormsg";
		var that = this;
		this.msgdiv.onclick = function(e) {
			that.clear();
		};
	},
	
	status: function(message) {
		this.msgdiv.innerHTML = message;
		this.msgdiv.className = "statusmsg";
		var that = this;
		this.msgdiv.onclick = function(e) {
			that.clear();
		};
	}
};

/*
 * Get a File object URL from form input or drag and drop.
 * Use XMLHttpRequest to retrieve the file content, and
 * pass the content on to be processed. Basic Javascript GPX
 * parsing based on https://github.com/peplin/gpxviewer/
 */
var loader = function(gpxfile, jscad) {
	
	Messages.clear();
	
	var radioValue = function(radios) {
		for (var i = 0, len = radios.length; i < len; i++) {
			if (radios[i].checked) {
				return parseInt(radios[i].value);
				break;
			}
		}
		return undefined;
	};
	
	var gpxurl = window.URL.createObjectURL(gpxfile);
	
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if (req.readyState === 4) {
			
			if (!req.responseXML) {
				Messages.error("This doesn't appear to be a GPX file.");
				return;
			}
			
			var gd = new Gpex(
					req.responseXML,
					jscad,
					document.getElementById('path_width').value / 2.0,
					document.getElementById('vertical').value,
					document.getElementById('width').value,
					document.getElementById('depth').value,
					document.getElementById('base').value,
					document.getElementById('zcut').checked,
					radioValue(document.getElementsByName('shape')),
					radioValue(document.getElementsByName('marker')),
					document.getElementById('mindist').value,
					document.getElementById('code_jscad'),
					document.getElementById('code_openscad'));
			gd.LoadTracks();
		}
	}
	
	req.open('GET', gpxurl, true);
	req.send(null);
	
	window.URL.revokeObjectURL(gpxurl);
}

function Gpex(content, jscad, buffer, vertical, bedx, bedy, base, zcut, shape, marker, mindist, code_jscad, code_openscad) {
	this.content = content;
	this.jscad = jscad;
	this.buffer = parseFloat(buffer);
	this.vertical = parseFloat(vertical);
	this.bedx = parseFloat(bedx);
	this.bedy = parseFloat(bedy);
	this.base = parseFloat(base);
	this.zcut = zcut;
	this.shape = shape;
	this.minimumDistance = parseFloat(mindist);
	this.code_jscad = code_jscad;
	this.code_openscad = code_openscad;
	
	// array of lon/lat/ele vectors (deg-ew/deg-ns/meters)
	this.ll = [];
	
	// array of segment distances
	// (Vincenty method applied to WGS84 input lat/lon coordinates)
	this.d = [];
	
	// total distance of route (sum of segment distances)
	this.distance = 0;
	
	// used for ring shape only; ring circumference = this.distance
	this.ringRadius = 0;
	
	// array of projected x/y/z vectors (meters) (pp = projected points)
	this.pp = [];
	
	// array of scaled/centered/z-cut x/y/z vectors (fp = final points)
	this.fp = [];
	
	// array of 2D vectors marking miles/kms
	this.markers = [];
	
	// remember indices of projected points bounding each marker
	// (so that marker segment angles can be computed after scaling)
	this.markseg = [];
	
	// meters per marker (0 = no markers)
	this.mpermark = marker;
	
	this.minx = 0;
	this.maxx = 0;
	this.miny = 0;
	this.maxy = 0;
	this.minz = 0;
	this.maxz = 0;
	
	this.xextent = 0;
	this.yextent = 0;
	this.zextent = 0;
	
	this.xoffset = 0;
	this.yoffset = 0;
	this.zoffset = 0;
	
	this.scale = 0;
	this.rotate = false;
}

Gpex.prototype.LoadTracks = function() {
	var tracks = this.content.documentElement.getElementsByTagName('trk');
	if (tracks.length === 0) {
		Messages.error("This file does not appear to contain any tracks.<br />" +
				"(Are you sure it is a GPX file?)");
		return;
	}
	this.LoadTrack(tracks[0]);
}

Gpex.prototype.LoadTrack = function(track) {
	var segments = track.getElementsByTagName('trkseg');
	if (segments.length === 0) {
		Messages.error("This file does not appear to contain any track segments.<br />" +
				"(Are you sure it is a valid GPX file?)");
		return;
	}
	this.LoadSegment(segments[0]);
}

Gpex.prototype.LoadSegment = function(segment) {
	
	var trkpts = segment.getElementsByTagName('trkpt');
	if (trkpts[0].getElementsByTagName('ele').length === 0) {
		Messages.error('This GPX file does not appear to contain any elevation data.<br />' +
				'Try using <a href="http://www.gpsvisualizer.com/elevation">GPX Visualizer</a> to add elevation data to your route.');
		return;
	}
	
	// populates this.ll (lat/lon vectors)
	this.ScanPoints(trkpts);
	
	// populates this.pp (projected point vectors)
	this.ProjectPoints();
	
	// scale/center projected point vectors
	this.fp = this.pp.map(this.pxyz, this);
	
	// scale/center markers (overwriting originals)
	this.markers = this.markers.map(this.pxyz, this);
	
	this.process_path();
	
	if (this.jscad.viewer) {
		this.jscad.viewer.setBedSize(this.bedx, this.bedy);
		
		// basemap only for track shape; otherwise,
		if (this.shape == 0) {
			this.basemap();
		} else {
			// reset bed texture to default checkerboard
			this.jscad.viewer.clearBaseMap(this.rotate);
		}
		
	}
	
	this.jscad.setJsCad(this.jscad_assemble(false));
	this.code_jscad.innerHTML = this.jscad_assemble(true);	
	this.code_openscad.innerHTML = this.oscad_assemble();
	
	document.getElementById('output').scrollIntoView();
}

// Converts GPX trkpt nodelist to array of lon/lat/elevation vectors.
// Also assembles array of segment distances (n - 1 where n = point count)
Gpex.prototype.ScanPoints = function(trkpts) {
	
	this.ll.push(this.llz(trkpts[0]));
	
	for (var current = 1, last = 0; current < trkpts.length; current++) {
		
		var point = this.llz(trkpts[current]);
		var dist = distVincenty(point[1], point[0], this.ll[last][1], this.ll[last][0]);
		
		if (this.minimumDistance == 0 || dist >= this.minimumDistance) {
			this.ll.push(point);
			this.d.push(dist);
			last += 1;
		}
	}
	
	this.distance = this.d.reduce(function(prev, cur) {
		return prev + cur;
	});
	
	this.ringRadius = this.distance / (Math.PI * 2);
}

// set min/max x/y/z bounds to the given xyz point
Gpex.prototype.InitBounds = function(xyz) {
	this.minx = xyz[0];
	this.maxx = xyz[0];
	this.miny = xyz[1];
	this.maxy = xyz[1];
	this.minz = xyz[2];
	this.maxz = xyz[2];
}

// update min/max x/y/z bounds to include the given xyz point
Gpex.prototype.UpdateBounds = function(xyz) {
	if (xyz[0] < this.minx) {
		this.minx = xyz[0];
	}
	
	if (xyz[0] > this.maxx) {
		this.maxx = xyz[0];
	}
	
	if (xyz[1] < this.miny) {
		this.miny = xyz[1];
	}
	
	if (xyz[1] > this.maxy) {
		this.maxy = xyz[1];
	}
	
	if (xyz[2] < this.minz) {
		this.minz = xyz[2];
	}
	
	if (xyz[2] > this.maxz) {
		this.maxz = xyz[2];
	}
}

// calculate extents (model size in each dimension) from bounds
Gpex.prototype.UpdateExtent = function() {
	this.xextent = this.maxx - this.minx;
	this.yextent = this.maxy - this.miny;
	this.zextent = this.maxz - this.minz;
}

// calculate offsets used to translate model to output origin
Gpex.prototype.UpdateOffset = function() {
	
	// xy offset used to center model around origin
	this.xoffset = (this.minx + this.maxx) / 2;
	this.yoffset = (this.miny + this.maxy) / 2;
	
	// zero z offset uses full height above sea level
	// disabled if minimum elevation is at or below 0
	if (this.zcut == false && this.minz > 0) {
		this.zoffset = 0;
	} else {
		// by default, z offset is calculated to cut
		// the elevation profile just below minimum
		this.zoffset = Math.floor(this.minz - 1);
	}
}

// jacked from http://stackoverflow.com/a/13274361/339879
// ne/se: [lng, lat]
// mapDim: {width: pixels, height: pixels}
function getBoundsZoomLevel(ne, sw, mapDim) {
    var WORLD_DIM = { height: 256, width: 256 };
    //var ZOOM_MAX = 21;

    function latRad(lat) {
        var sin = Math.sin(lat * Math.PI / 180);
        var radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
        return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
    }

	//Math.floor
    function zoom(mapPx, worldPx, fraction) {
        return (Math.log(mapPx / worldPx / fraction) / Math.LN2);
    }

    var latFraction = (latRad(ne[1]) - latRad(sw[1])) / Math.PI;

    var lngDiff = ne[0] - sw[0];
    var lngFraction = ((lngDiff < 0) ? (lngDiff + 360) : lngDiff) / 360;
	
    var latZoom = zoom(mapDim.height, WORLD_DIM.height, latFraction);
    var lngZoom = zoom(mapDim.width, WORLD_DIM.width, lngFraction);
	
	return {
		zoom: latZoom < lngZoom ? Math.floor(latZoom) : Math.floor(lngZoom),
		span: latZoom < lngZoom ? latFraction : lngFraction,
		axis: latZoom < lngZoom ? "height" : "width"
	};
}

Gpex.prototype.basemap = function() {
	
	var bedmax = Math.max(this.bedx, this.bedy);
	var mapsize = {
		width:  Math.round(640 * (this.rotate ? this.bedy : this.bedx) / bedmax),
		height: Math.round(640 * (this.rotate ? this.bedx : this.bedy) / bedmax)
	};
	
	var sw = proj4("GOOGLE", "WGS84", [this.minx, this.miny]);
	var ne = proj4("GOOGLE", "WGS84", [this.maxx, this.maxy]);
	var zoominfo = getBoundsZoomLevel(ne, sw, mapsize);
	
	if (zoominfo.zoom > 21) {
		// don't bother with base map if zoom level would be too high
		this.jscad.viewer.clearBaseMap(this.rotate);
		return;
	}
	
	var mapscale = mapsize[zoominfo.axis] / 256 / Math.exp(zoominfo.zoom * Math.LN2) / zoominfo.span;
	
	var center = proj4("GOOGLE", "WGS84", [this.xoffset, this.yoffset]);

	var mapurl = "https://maps.googleapis.com/maps/api/staticmap?center=" + center[1].toFixed(6) + "," + center[0].toFixed(6) + "&zoom=" + zoominfo.zoom + "&size=" + mapsize.width + "x" + mapsize.height + "&maptype=terrain&scale=2&format=jpg";
	
	this.jscad.viewer.setBaseMap(mapurl, mapscale, this.rotate);
}

// calculate scale used to fit model on output bed
Gpex.prototype.UpdateScale = function() {
	// indent bed extent to accomodate buffer width
	var xbe = this.bedx - (2 * this.buffer),
		ybe = this.bedy - (2 * this.buffer);
	var mmax = Math.max(this.xextent, this.yextent),
		mmin = Math.min(this.xextent, this.yextent),
		bmax = Math.max(xbe, ybe),
		bmin = Math.min(xbe, ybe),
		fmax = bmax / mmax,
		fmin = bmin / mmin;
	this.scale = Math.min(fmax, fmin);

	// determine whether the model should be rotated to fit
	if ((xbe >= ybe && this.xextent >= this.yextent) ||
		(xbe < ybe && this.xextent < this.yextent)) {
		this.rotate = false;
	} else {
		this.rotate = true;
	}
}

// point to project and cumulative distance along path
Gpex.prototype.ProjectPoint = function(point, cd) {
	var xyz;
	if (this.shape == 1) {
		xyz = PointProjector.linear(point, cd);
	} else if (this.shape == 2) {
		xyz = PointProjector.ring(point, cd/this.distance, this.ringRadius);
	} else {
		xyz = PointProjector.mercator(point);
	}
	return xyz;
}

Gpex.prototype.ProjectPoints = function() {
	
	// cumulative distance
	var cd = 0;
	
	// distance since last marker
	var md = 0, lastmd = 0;
	
	// Initialize extents using first projected point.
	var xyz = this.ProjectPoint(this.ll[0], 0);
	this.InitBounds(xyz);
	this.pp.push(xyz);
	
	// Project the rest of the points, updating extents.
	for (var i = 1; i < this.ll.length; i++) {
		
		lastmd = md;
		md += this.d[i-1];
		cd += this.d[i-1];
		
		xyz = this.ProjectPoint(this.ll[i], cd);
		this.UpdateBounds(xyz);
		this.pp.push(xyz);
		
		// If we've met or exceeded distance to next marker,
		// determine its exact location and add it to list.
		// (No marker calculations if mpermark is zero)
		if (this.mpermark > 0 && md >= this.mpermark) {
			
			var last_seg = this.mpermark - lastmd;
			var seg_length = md - lastmd;
			var next_seg = seg_length - last_seg;
			var pd = last_seg / seg_length;
			
			// marker located along segment between previous and current point
			// pd is the proportionate distance along that vector
			var markerpoint = [
				this.ll[i-1][0] + pd * (this.ll[i][0] - this.ll[i-1][0]),
				this.ll[i-1][1] + pd * (this.ll[i][1] - this.ll[i-1][1]),
				this.ll[i-1][2] + pd * (this.ll[i][2] - this.ll[i-1][2])
			];
			
			// store projected marker location
			this.markers.push(this.ProjectPoint(markerpoint, cd - next_seg));
			this.markseg.push([i - 1, i]);
			
			// reset distance to next marker
			md = next_seg;
		}
	}
	
	this.UpdateExtent();
	this.UpdateOffset();
	this.UpdateScale();
}

Gpex.prototype.vector_angle = function(a, b) {
	var dx = b[0] - a[0],
		dy = b[1] - a[1];
	return Math.atan2(dy, dx);
}

/*
 * Given a point array and index of a point,
 * return the angle of the vector from that point
 * to the next. (2D) (If the index is to the last point,
 * return the preceding segment's angle. Point array
 * should have at least 2 points!)
 */
Gpex.prototype.segment_angle = function(i) {
	
	// in case of final point, repeat last segment angle
	if (i + 1 == this.fp.length) {
		return this.segment_angle(i - 1);
	}
	
	// angle between this point and the next
	return this.vector_angle(this.fp[i], this.fp[i + 1]);
}

/*
 * Return a pair of 2D points representing the joints
 * where the buffered paths around the actual segment
 * intersect - segment endpoints offset perpendicular
 * to segment by buffer distance, adjusted for tidy
 * intersection with adjacent segment's buffered path.
 * absa is absolute angle of this segment; avga is the
 * average angle between this segment and the next.
 * (p could be kept as a Gpex property.)
 */
Gpex.prototype.joint_points = function(i, rel, avga) {

	// distance from endpoint to segment buffer intersection
	var jointr = this.buffer/Math.cos(rel/2);
	
	// arbitrary hack to prevent extremely spiky corner artifacts
	// on acute angles. Real solution requires an additional corner
	// point or possibly swapping l/r vertices for successive segs.
	// (As-is, buffer width will not be maintained on acute corners.)
	if (Math.abs(jointr) > this.buffer * 2) {
		jointr = Math.sign(jointr) * this.buffer * 2;
	}
	
	// joint coordinates (endpoint offset at bisect angle by jointr)
	var	lx = this.fp[i][0] + jointr * Math.cos(avga + Math.PI/2),
		ly = this.fp[i][1] + jointr * Math.sin(avga + Math.PI/2),
		rx = this.fp[i][0] + jointr * Math.cos(avga - Math.PI/2),
		ry = this.fp[i][1] + jointr * Math.sin(avga - Math.PI/2);
	
	return [[lx, ly], [rx, ry]];
}

/*
 * Given a point array fp with at least two points, loop
 * through each segment (pair of points). In each iteration
 * of the for loop, pj and pk are the 2D coordinates of the
 * corners of the quad representing a buffered path for
 * that segment; consecutive segments share endpoints.
 */
Gpex.prototype.process_path = function() {
	
		// angle of initial segment (ids 0 - 1)
	var last_angle = this.segment_angle(0),
		
		// angle of next segment
		angle,
		
		// relative angle (angle of this segment relative to last)
		rel_angle = 0,
		
		// joint angle: split the difference between neighboring segments
		// (initially, same as initial segment)
		joint_angle = last_angle,
		
		// 2d segment corner base points, buffered from point 0 (i),
		// oriented perpendicular to joint angle ja
		pp = this.joint_points(0, 0, joint_angle);
	
	// first four points of segment polyhedron
	var vertices = [];
	PathSegment.points(vertices, pp, this.fp[0][2]);
	
	// initial endcap
	var faces = [];
	PathSegment.first_face(faces);
	
	for (var i = 1; i < this.fp.length; i++) {
		
		angle = this.segment_angle(i);
		rel_angle = angle - last_angle;
		joint_angle = rel_angle / 2 + last_angle;
		pp = this.joint_points(i, rel_angle, joint_angle);
		
		// next four points of segment polyhedron
		PathSegment.points(vertices, pp, this.fp[i][2]);
		
		// faces connecting first four points to last four of segment
		PathSegment.faces(faces, i);
		
		last_angle = angle;
	}
	
	// final endcap
	PathSegment.last_face(faces, i);
	
	// generate array of point vector SCAD strings
	this.model_points = vertices.map(function(v) {
		return "[" + v[0].toFixed(4) + ", " + v[1].toFixed(4) + ", " + v[2].toFixed(4) + "]";
	});
	
	// generate array of face list SCAD strings
	this.model_faces = faces.map(function(v) {
		return "[" + v[0] + ", " + v[1] + ", " + v[2] + "]";
	});
}

// returns jscad for one marker
// use oscad-style cube params rather than corner1 and corner2

// set these code generators up as objects that can keep track of whether
// they need to include "CSG.", etc, rather than passing this boolean dl param around
Gpex.prototype.jscad_marker = function(i, dl) {
	var x = this.markers[i][0],
		y = this.markers[i][1],
		z = this.markers[i][2],
		r = this.buffer + 1,
		
		// angle between this the projected/scaled/centered points comprising the segment
		// along which this marker lies.
		t = this.vector_angle(this.fp[this.markseg[i][0]], this.fp[this.markseg[i][1]]);
	
	if (dl == true) {
		var scad = "cube({size: [1, " + (2 * r) + ", " + z + "], center: true})" +
				".rotateZ(" + (t * 180 / Math.PI) + ")" +
				".translate([" + x + ", " + y + ", " + z/2 + "])";
	} else {
		var scad = "CSG.cube({radius: [1, " + (2 * r) + ", " + z/2 + "], center: [0, 0, 0]})" +
				".rotateZ(" + (t * 180 / Math.PI) + ")" +
				".translate([" + x + ", " + y + ", " + z/2 + "])";
	}
		
	return scad;
}

// returns jscad function for markers
Gpex.prototype.jscad_markers = function(dl) {
	
	// return empty string if markers are disabled
	if (this.mpermark <= 0) {
		return "";
	}
	
	var markers = [];
	for (var i = 0; i < this.markers.length; i++) {
		markers.push(this.jscad_marker(i, dl));
	}
	
	var jscad = markers[0] + markers.slice(1).map(function(s) {
		return ".union(" + s + ")";
	}).join("");
	
	//var jscad = markers[0].join(".union(\n") + ")";
	
	if (this.rotate) {
		jscad += ".rotateZ(90)";
	}
	
	return "function markers() {\nreturn " + jscad + ";\n}\n\n";
}

// returns jscad function for profile
Gpex.prototype.jscad_profile = function(dl) {
	var jscad = (dl == true ? "" : "CSG.") + "polyhedron({points:[\n" +
			this.model_points.join(",\n") + "\n],\n" +
			(dl == true ? "triangles" : "faces") + ":[\n" +
			this.model_faces.join(",\n") + "\n]})";
	
	if (this.rotate) {
		jscad += ".rotateZ(90)";
	}
	
	return "function profile() {\nreturn " + jscad + ";\n}\n\n";
}

// dl = download version (webgl jscad is not openjscad.org compatible)
Gpex.prototype.jscad_assemble = function(dl) {
	var jscad = this.jscad_profile(dl) + this.jscad_markers(dl);
	
	if (dl == true) {
		var um = (this.mpermark > 0 ? ".union(markers())" : "");
		var mainf = "function main() {\nreturn profile()" + um + ";\n}\n";
	} else {
		var models = ["{name: 'profile', caption: 'Profile', data: profile()}"];
		
		if (this.mpermark > 0) {
			models.push("{name: 'markers', caption: 'Markers', data: markers()}");
		}
		
		var mainf = "function main() {\nreturn [" + models.join(',') + "];\n}\n";
	}
	
	return jscad + mainf;
}

Gpex.prototype.oscad_assemble = function() {
	var openscad = "module profile() {\npolyhedron(points=[\n" + this.model_points.join(",\n") + "\n],\nfaces=[\n" + this.model_faces.join(",\n") + "\n]);\n}\n";

	if (this.mpermark > 0) {
		openscad += this.oscad_markers();
		openscad += "markers();\n";
	}
	
	openscad += "profile();\n";
	return openscad;
}

Gpex.prototype.oscad_markers = function() {
	var m = [];
	for (var i = 0; i < this.markers.length; i++) {
		m.push(this.oscad_marker(i));
	}
	return "module markers() {\nunion() {\n" + m.join("\n") + "\n}\n}\n";
}

Gpex.prototype.oscad_marker = function(i) {
	var x = this.markers[i][0],
		y = this.markers[i][1],
		z = this.markers[i][2],
		r = this.buffer + 1,
		t = this.vector_angle(this.fp[this.markseg[i][0]], this.fp[this.markseg[i][1]]);
	return "translate([" + x + ", " + y + ", " + z/2 + "]) " + 
		   "rotate([0, 0, " + (t * 180/Math.PI) + "]) " + 
		   "cube(size=[1, " + (2 * r) + ", " + z + "], center=true);";
}

var PathSegment = {
	
	// Corner points of quad perpendicular to path 
	points: function(a, v, z) {
		
		// lower left
		a.push([v[0][0], v[0][1], 0]);
		
		// lower right
		a.push([v[1][0], v[1][1], 0]);
		
		// upper left
		a.push([v[0][0], v[0][1], z]);
		
		// upper right
		a.push([v[1][0], v[1][1], z]);
	},
	
	// Initial endcap face
	first_face: function(a) {
		a.push([0, 2, 3]);
		a.push([3, 1, 0]);
	},
	
	// Final endcap face; s is segment index
	last_face: function(a, s) {
		
		// i is index of first corner point of segment
		var i = (s - 1) * 4;
		
		a.push([i + 2, i + 1, i + 3]);
		a.push([i + 2, i + 0, i + 1]);
	},
	
	// Path segment faces; s is segment index
	faces: function(a, s) {
		
		// i is index of first corner point of segment
		var i = (s - 1) * 4;
		
		// top face
		a.push([i + 2, i + 6, i + 3]);
		a.push([i + 3, i + 6, i + 7]);
		
		// left face
		a.push([i + 3, i + 7, i + 5]);
		a.push([i + 3, i + 5, i + 1]);
		
		// right face
		a.push([i + 6, i + 2, i + 0]);
		a.push([i + 6, i + 0, i + 4]);
		
		// bottom face
		a.push([i + 0, i + 5, i + 4]);
		a.push([i + 0, i + 1, i + 5]);
	}
	
};

// returns a scaled and centered output unit [x, y, z] vector from input [x, y, z] Projected vector
Gpex.prototype.pxyz = function(v) {
	return [
			this.scale * (v[0] - this.xoffset),
			this.scale * (v[1] - this.yoffset),
			this.scale * (v[2] - this.zoffset) * this.vertical + this.base
	];
}

// returns numeric [longitude, latitude, elevation] vector from GPX track point
Gpex.prototype.llz = function(pt) {
	return [
			parseFloat(pt.getAttribute('lon')),
			parseFloat(pt.getAttribute('lat')),
			parseFloat(pt.getElementsByTagName('ele')[0].innerHTML)
	];
}

/*
 * Point Projection Methods
 * 
 * Parameters:
 *  v, a 3-element vector [longitude, latitude, elevation]
 *  dist, position of point along path (meters)
 *  distRatio, ratio of point position to path length
 *  radius of ring, supposing circumference is path length
 * 
 * Return Value:
 *  a 3-element vector [x, y, z] (meters)
 */
var PointProjector = {
	
	linear: function(v, dist) {
		return [0, dist, v[2]];
	},
	
	ring: function(v, distRatio, radius) {
		return [
			radius * Math.cos(2 * Math.PI * distRatio),
			radius * Math.sin(2 * Math.PI * distRatio),
			v[2]
		];
	},
	
	mercator: function(v) {
		return proj4('GOOGLE', [v[0], v[1]]).concat(v[2]);
	}
};
function bezierCircle(cx, cy, r) {
    // 6 segments, so 60 degrees each.
    const angles = [270, 210, 150, 90, 30, 330].map(a => a * Math.PI / 180);
    // distance to control points
    const L = r * (4/3) * Math.tan(Math.PI / 12);
    
    let path = "";
    for (let i = 0; i < angles.length; i++) {
        const a1 = angles[i];
        const a2 = angles[(i + 1) % angles.length];
        
        const p1x = cx + r * Math.cos(a1);
        const p1y = cy + r * Math.sin(a1);
        
        const p2x = cx + r * Math.cos(a2);
        const p2y = cy + r * Math.sin(a2);
        
        // Tangents are a1 + 90deg and a2 - 90deg
        const cp1x = p1x + L * Math.cos(a1 + Math.PI/2);
        const cp1y = p1y + L * Math.sin(a1 + Math.PI/2);
        
        const cp2x = p2x + L * Math.cos(a2 - Math.PI/2);
        const cp2y = p2y + L * Math.sin(a2 - Math.PI/2);
        
        if (i === 0) {
            path += `M ${p1x.toFixed(2)} ${p1y.toFixed(2)}\n`;
        }
        path += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2x.toFixed(2)} ${p2y.toFixed(2)}\n`;
    }
    return path + "Z";
}

function logoOuter() {
    const pts = [
        [60, 15],
        [15, 100],
        [42, 100],
        [60, 62],
        [78, 100],
        [105, 100]
    ];
    let path = `M ${pts[0][0]} ${pts[0][1]}\n`;
    for(let i=0; i<6; i++) {
        const p1 = pts[i];
        const p2 = pts[(i+1)%6];
        const cp1x = p1[0] + (p2[0]-p1[0])/3;
        const cp1y = p1[1] + (p2[1]-p1[1])/3;
        const cp2x = p1[0] + 2*(p2[0]-p1[0])/3;
        const cp2y = p1[1] + 2*(p2[1]-p1[1])/3;
        path += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}\n`;
    }
    return path + "Z";
}

console.log("CIRCLE:");
console.log(bezierCircle(60, 60, 40));
console.log("\nLOGO OUTER:");
console.log(logoOuter());

function bezierCircle3(cx, cy, r) {
    const angles = [270, 150, 30].map(a => a * Math.PI / 180);
    // 120 degrees each.
    const L = r * (4/3) * Math.tan(Math.PI / 6);
    let path = "";
    for (let i = 0; i < angles.length; i++) {
        const a1 = angles[i];
        const a2 = angles[(i + 1) % angles.length];
        const p1x = cx + r * Math.cos(a1);
        const p1y = cy + r * Math.sin(a1);
        const p2x = cx + r * Math.cos(a2);
        const p2y = cy + r * Math.sin(a2);
        const cp1x = p1x + L * Math.cos(a1 + Math.PI/2);
        const cp1y = p1y + L * Math.sin(a1 + Math.PI/2);
        const cp2x = p2x + L * Math.cos(a2 - Math.PI/2);
        const cp2y = p2y + L * Math.sin(a2 - Math.PI/2);
        if (i === 0) path += `M ${p1x.toFixed(2)} ${p1y.toFixed(2)}\n`;
        path += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2x.toFixed(2)} ${p2y.toFixed(2)}\n`;
    }
    return path + "Z";
}

function logoInner() {
    const pts = [
        [60, 62],
        [42, 100],
        [78, 100]
    ];
    let path = `M ${pts[0][0]} ${pts[0][1]}\n`;
    for(let i=0; i<3; i++) {
        const p1 = pts[i];
        const p2 = pts[(i+1)%3];
        const cp1x = p1[0] + (p2[0]-p1[0])/3;
        const cp1y = p1[1] + (p2[1]-p1[1])/3;
        const cp2x = p1[0] + 2*(p2[0]-p1[0])/3;
        const cp2y = p1[1] + 2*(p2[1]-p1[1])/3;
        path += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}\n`;
    }
    return path + "Z";
}

console.log("\nINNER CIRCLE:");
console.log(bezierCircle3(60, 60, 15));
console.log("\nLOGO INNER:");
console.log(logoInner());


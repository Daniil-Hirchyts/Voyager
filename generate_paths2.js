function bezierCircle(cx, cy, r) {
    const angles = [270, 330, 30, 90, 150, 210].map(a => a * Math.PI / 180);
    const L = r * (4/3) * Math.tan(Math.PI / 12); // tan(15 deg)
    
    let path = "";
    for (let i = 0; i < angles.length; i++) {
        const a1 = angles[i];
        const a2 = angles[(i + 1) % angles.length];
        
        const p1x = cx + r * Math.cos(a1);
        const p1y = cy + r * Math.sin(a1);
        
        const p2x = cx + r * Math.cos(a2);
        const p2y = cy + r * Math.sin(a2);
        
        // For clockwise, tangent at a1 is a1 + 90 deg
        const cp1x = p1x + L * Math.cos(a1 + Math.PI/2);
        const cp1y = p1y + L * Math.sin(a1 + Math.PI/2);
        
        // Tangent arriving at a2 is a2 - 90 deg (backward)
        const cp2x = p2x + L * Math.cos(a2 - Math.PI/2);
        const cp2y = p2y + L * Math.sin(a2 - Math.PI/2);
        
        if (i === 0) path += `M ${p1x.toFixed(2)} ${p1y.toFixed(2)}\n`;
        path += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2x.toFixed(2)} ${p2y.toFixed(2)}\n`;
    }
    return path + "Z";
}

console.log("CIRCLE CLOCKWISE:");
console.log(bezierCircle(60, 60, 40));

function bezierCircle3(cx, cy, r) {
    // Inner triangle maps to 3 points. Clockwise: top, right, left.
    // Inner logo points: (60,62), (42,100), (78,100). That is Top, Left, Right (Counter-clockwise!)
    // Logo Inner sequence:
    // 1. (60,62) [Top]
    // 2. (42,100) [Left]
    // 3. (78,100) [Right]
    // So angles for CCW from top: 270, 150, 30.
    const angles = [270, 150, 30].map(a => a * Math.PI / 180);
    const L = r * (4/3) * Math.tan(Math.PI / 6); // tan(30 deg)
    
    let path = "";
    for (let i = 0; i < angles.length; i++) {
        const a1 = angles[i];
        const a2 = angles[(i + 1) % angles.length];
        
        const p1x = cx + r * Math.cos(a1);
        const p1y = cy + r * Math.sin(a1);
        
        const p2x = cx + r * Math.cos(a2);
        const p2y = cy + r * Math.sin(a2);
        
        // For CCW, tangent at a1 is a1 - 90 deg
        const cp1x = p1x + L * Math.cos(a1 - Math.PI/2);
        const cp1y = p1y + L * Math.sin(a1 - Math.PI/2);
        
        // Tangent arriving at a2 is a2 + 90 deg
        const cp2x = p2x + L * Math.cos(a2 + Math.PI/2);
        const cp2y = p2y + L * Math.sin(a2 + Math.PI/2);
        
        if (i === 0) path += `M ${p1x.toFixed(2)} ${p1y.toFixed(2)}\n`;
        path += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2x.toFixed(2)} ${p2y.toFixed(2)}\n`;
    }
    return path + "Z";
}
console.log("\nINNER CIRCLE CCW:");
console.log(bezierCircle3(60, 75, 20));

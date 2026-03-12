const logoOuter = "M 60 15 L 15 100 L 42 100 L 60 62 L 78 100 L 105 100 Z";
const logoInner = "M 60 62 L 42 100 L 78 100 Z";
const planeOuter = "M 60 25 L 15 65 L 45 100 L 60 95 L 75 100 L 105 65 Z";
const planeInner = "M 60 45 L 50 60 L 70 60 Z";

console.log("Outer Logo segments:", logoOuter.split(/[MLZ]/).filter(s => s.trim().length > 0).length);
console.log("Outer Plane segments:", planeOuter.split(/[MLZ]/).filter(s => s.trim().length > 0).length);
console.log("Inner Logo segments:", logoInner.split(/[MLZ]/).filter(s => s.trim().length > 0).length);
console.log("Inner Plane segments:", planeInner.split(/[MLZ]/).filter(s => s.trim().length > 0).length);

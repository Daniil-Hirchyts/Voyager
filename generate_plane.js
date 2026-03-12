const fs = require('fs');

const svg = `
<svg width="200" height="200" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <!-- Plane Outer -->
  <path d="M 60 20 L 20 60 L 50 100 L 60 90 L 70 100 L 100 60 Z" fill="black" opacity="0.5"/>
  <!-- Plane Inner (can be window or center fuselage) -->
  <path d="M 60 40 L 55 60 L 65 60 Z" fill="white" />
</svg>
`;

fs.writeFileSync('plane_test.svg', svg);
console.log("Plane generated.");

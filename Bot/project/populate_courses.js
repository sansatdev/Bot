 // populate_courses.js
import sqlite3 from 'sqlite3';
import DBManager from './dbManager.js'; // Import the new DBManager

const DB_PATH = './w3s-dynamic-storage/database.db';

// Your static course data (copy this directly from your server.js)
const courseList = `1. FY ATKT Exam - Division
2. FYB.HON - Division A
3. FYBAF - Division A
4. FYBAF - Division B
5. FYBAF - Division C
6. FYBAF - Division D
7. FYBAFTNMP - Division A
8. FYBAMMC - Division A
9. FYBAMMC - Division B
10. FYBAMMC - Division C
11. FYBAMMC - Division D
12. FYBBI - Division A
13. FYBBI - Division B
14. FYBCOM BA - Division A
15. FYBCOM DB - Division A
16. FYBCOM ENT - Division A
17. FYBCOM IA - Division A
18. FYBCOM - Division O
19. FYBCOM - Division P
20. FYBCOM - Division Q
21. FYBCOM - Division R
22. FYBCOM - Division S
23. FYBCOM SIM - Division A
24. FYBCOM - Division T
25. FYBFM - Division A
26. FYBIM - Division A
27. FYBMS - Division A
28. FYBMS - Division B
29. FYBMS - Division C
30. FYBMS - Division D
31. FYBMS - Division E
32. FYBSC AIML - Division A
33. FYBSC AS - Division A
34. FYBSC AVFX - Division A
35. FYBSC AVFX - Division B
36. FYBSC BT - Division A
37. FYBSC - Division CB
38. FYBSC CB - Division A
39. FYBSC CB - Division B
40. FYBSC CS - Division A
41. FYBSC CS - Division B
42. FYBSC - Division CZ
43. FYBSC CZ - Division A
44. FYBSC CZ - Division B
45. FYBSC DS - Division A
46. FYBSC ID - Division A
47. FYBSC ID - Division B
48. FYBSC IT - Division A
49. FYBSC IT - Division B
50. FYBSC - Division PC
51. FYBSC PC - Division A
52. FYBSC PC - Division B
53. FYBSC - Division PM
54. FYBSC PM - Division A
55. FYBSC PM - Division B
56. FYBSC SS - Division A
57. FYMAEMA - Division A
58. FYMCOM AA - Division A
59. FYMCOM BF - Division A
60. FYMCOM E-Com - Division A
61. FYMSC - Division
62. FYSM - Division A
63. Part-1 MSC - Division A
64. Part-1 MSC Bot - Division
65. Part-1 MSC CS - Division A
66. Part-1 MSC DS - Division A
67. Part-1 MSC Inorganic Chem - Division
68. Part-1 MSC IT - Division A
69. Part-1 MSC Organic Chem - Division
70. Part-1 MSC Zoo - Division
71. Part-2 MSC - Division A
72. Part-2 MSC Bot - Division
73. Part-2 MSC Che - Division
74. Part-2 MSC CS - Division A
75. Part-2 MSC DS - Division A
76. Part-2 MSC Inorganic Chem - Division
77. Part-2 MSC IT - Division A
78. Part-2 MSC Organic Chem - Division
79. Part-2 MSC Zoo - Division
80. SYB.HON - Division A
81. SYBAF - Division A
82. SYBAF - Division B
83. SYBAF - Division C
84. SYBAF - Division D
85. SYBAFTNMP - Division A
86. SYBAMMC - Division A
87. SYBAMMC - Division B
88. SYBAMMC - Division C
89. SYBAMMC - Division D
90. SYBBI - Division A
91. SYBCOM DB - Division A
92. SYBCOM ENT - Division A
93. SYBCOM - Division H
94. SYBCOM - Division I
95. SYBCOM IA - Division A
96. SYBCOM - Division J
97. SYBCOM - Division K
98. SYBCOM - Division L
99. SYBCOM SIM - Division
100. SYBFM - Division A
101. SYBIM - Division A
102. SYBMS - Division A
103. SYBMS - Division B
104. SYBMS - Division C
105. SYBMS - Division D
106. SYBSC - Division A
107. SYBSC AS - Division A
108. SYBSC AVFX - Division A
109. SYBSC AVFX - Division B
110. SYBSC AVFX - Division C
111. SYBSC BT - Division A
112. SYBSC CB - Division Botany major
113. SYBSC CB - Division Chem Major
114. SYBSC CS - Division A
115. SYBSC CS - Division B
116. SYBSC CZ - Division A
117. SYBSC CZ - Division B
118. SYBSC CZ - Division Chem Major
119. SYBSC CZ - Division Zoo Major
120. SYBSC DS - Division A
121. SYBSC IT - Division A
122. SYBSC IT - Division B
123. SYBSC PC - Division A
124. SYBSC PC - Division B
125. SYBSC PC - Division Chem Major
126. SYBSC PC - Division Phy Major
127. SYBSC PM - Division A
128. SYBSC PM - Division B
129. SYBSC PM - Division Math Major
130. SYBSC PM - Division Phy Major
131. SYBSC SS - Division A
132. SYMAEMA - Division A
133. SYMCOM AA - Division A
134. SYMCOM BF - Division A
135. SYMCOM E-Com - Division A
136. SYSelect Course - Division A
137. TYB.HON - Division A
138. TYBAF - Division A
139. TYBAF - Division B
140. TYBAF - Division C
141. TYBAF - Division D
142. TYBAFTNMP - Division A
143. TYBAMMC - Division A
144. TYBAMMC - Division B
145. TYBAMMC - Division C
146. TYBAMMC - Division D
147. TYBBI - Division A
148. TYBCOM - Division A
149. TYBCOM - Division B
150. TYBCOM - Division C
151. TYBCOM - Division D
152. TYBCOM DB - Division A
153. TYBCOM - Division E
154. TYBCOM ENT - Division A
155. TYBCOM IA - Division A
156. TYBFM - Division A
157. TYBIM - Division A
158. TYBMS - Division A
159. TYBMS - Division B
160. TYBMS - Division C
161. TYBMS - Division D
162. TYBSC - Division A
163. TYBSC AS - Division A
164. TYBSC AS - Division B
165. TYBSC AS - Division C
166. TYBSC AVFX - Division A
167. TYBSC AVFX - Division B
168. TYBSC AVFX - Division C
169. TYBSC Bot - Division A
170. TYBSC BT - Division A
171. TYBSC Chem - Division A
172. TYBSC CS - Division A
173. TYBSC CS - Division B
174. TYBSC DS - Division A
175. TYBSC IT - Division A
176. TYBSC IT - Division B
177. TYBSC Maths - Division A
178. TYBSC Phy - Division A
179. TYBSC SS - Division A
180. TYBSC Zoo - Division A
`;

// Map original index to course ID (these are the actual class_ids for the API)
const courseMapping = {
    1: '731', 2: '583', 3: '593', 4: '594', 5: '595', 6: '596', 7: '597', 8: '565', 9: '566', 10: '567', 11: '569', 12: '605', 13: '606', 14: '701', 15: '598', 16: '572', 17: '579', 18: '697', 19: '588', 20: '589', 21: '590', 22: '591', 23: '581', 24: '592', 25: '599', 26: '600', 27: '601', 28: '602', 29: '603', 30: '604', 31: '718', 32: '698', 33: '607', 34: '562', 35: '726', 36: '570', 37: '719', 38: '627', 39: '727', 40: '561', 41: '576', 42: '720', 43: '628', 44: '728', 45: '571', 46: '699', 47: '732', 48: '563', 49: '568', 50: '721', 51: '629', 52: '729', 53: '722', 54: '630', 55: '730', 56: '608', 57: '587', 58: '573', 59: '584', 60: '582', 61: '586', 62: '700', 63: '564', 64: '621', 65: '580', 66: '585', 67: '631', 68: '578', 69: '632', 70: '622', 71: '540', 72: '623', 73: '626', 74: '544', 75: '708', 76: '633', 77: '549', 78: '634', 79: '624', 80: '553', 81: '519', 82: '520', 83: '521', 84: '650', 85: '529', 86: '522', 87: '523', 88: '524', 89: '653', 90: '530', 91: '555', 92: '556', 93: '532', 94: '533', 95: '550', 96: '534', 97: '535', 98: '551', 99: '707', 100: '528', 101: '531', 102: '525', 103: '526', 104: '527', 105: '536', 106: '717', 107: '558', 108: '538', 109: '705', 110: '706', 111: '545', 112: '709', 113: '612', 114: '539', 115: '548', 116: '712', 117: '711', 118: '613', 119: '710', 120: '546', 121: '541', 122: '542', 123: '690', 124: '689', 125: '713', 126: '614', 127: '716', 128: '715', 129: '714', 130: '615', 131: '559', 132: '557', 133: '547', 134: '554', 135: '552', 136: '543', 137: '514', 138: '485', 139: '486', 140: '487', 141: '702', 142: '497', 143: '488', 144: '489', 145: '490', 146: '494', 147: '498', 148: '500', 149: '501', 150: '502', 151: '503', 152: '515', 153: '504', 154: '516', 155: '513', 156: '496', 157: '499', 158: '491', 159: '492', 160: '493', 161: '495', 162: '723', 163: '518', 164: '724', 165: '725', 166: '505', 167: '703', 168: '704', 169: '616', 170: '510', 171: '617', 172: '507', 173: '512', 174: '511', 175: '508', 176: '509', 177: '618', 178: '619', 179: '517', 180: '620'
};


// Function to parse the courseList and create an array of course objects
const coursesToInsert = courseList.split('\n')
    .filter(line => line.trim() !== '')
    .map((line, index) => {
        const parts = line.match(/^(\d+)\.\s*(.*)/);
        if (parts) {
            const originalIndex = parseInt(parts[1]);
            const name = parts[2].trim();
            return { originalIndex: originalIndex, name: name, apiId: courseMapping[originalIndex] };
        }
        return null;
    }).filter(Boolean);

async function populateCourses() {
    const dbManager = new DBManager(); // Initialize DBManager to ensure table exists

    // Small delay to ensure table creation completes (serialize helps, but a tiny delay is safer)
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
        console.log('Starting course data population...');
        for (const course of coursesToInsert) {
            if (course.apiId) { // Only insert if a valid API ID exists
                await dbManager.insertCourse(course.originalIndex, course.name, course.apiId);
            } else {
                console.warn(`Skipping course ${course.originalIndex}. ${course.name} - No API ID found.`);
            }
        }
        console.log('Course data population complete.');

        // Optional: Verify population
        const count = await dbManager.getTotalCoursesCount();
        console.log(`Total courses in DB: ${count}`);

    } catch (error) {
        console.error('Error populating courses:', error);
    } finally {
        dbManager.db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            } else {
                console.log('Database connection closed.');
            }
        });
    }
}

populateCourses();
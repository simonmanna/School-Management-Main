#!/usr/bin/env bash
set -u
B=http://localhost:3001/api/v1
TOKEN=$(curl -s -X POST $B/auth/login -H "Content-Type: application/json" -d '{"organizationCode":"DEMO","email":"admin@demo.test","password":"Admin@123"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])" 2>/dev/null)
auth="Authorization: Bearer $TOKEN"
code(){ curl -s -o /tmp/b -w "%{http_code}" "$@"; }
mk(){ python -c "import json;d=json.load(open('/tmp/b'));print(d.get('id','')) if isinstance(d,dict) else print('')" 2>/dev/null; }
SUB=$(curl -s "$B/school/subjects?pageSize=5" -H "$auth" | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
CLASS=$(curl -s "$B/school/classes?pageSize=5" -H "$auth" | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
TERM=$(curl -s "$B/school/terms?pageSize=5" -H "$auth" | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
ET=$(curl -s "$B/school/exam-types?pageSize=5" -H "$auth" | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
STU=$(curl -s "$B/school/students?pageSize=5" -H "$auth" | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
TS=$(date +%s)
echo "SUB=$SUB CLASS=$CLASS TERM=$TERM ET=$ET STU=$STU"
echo "================ ASSESSMENT & EXAMINATION CRUD SWEEP (corrected) ================"

# Assessment Policy
c=$(code -X POST "$B/school/assessment-policies" -H "$auth" -H "Content-Type: application/json" -d "{\"name\":\"POL$TS\"}"); PID=$(mk); c2=$(code -X PATCH "$B/school/assessment-policies/$PID" -H "$auth" -H "Content-Type: application/json" -d '{"name":"POLE"}'); c3=$(code -X DELETE "$B/school/assessment-policies/$PID" -H "$auth"); echo "assessment-policies: C=$c P=$c2 D=$c3"

# Assessment Component
if [ -n "$PID" ]; then c=$(code -X POST "$B/school/assessment-components" -H "$auth" -H "Content-Type: application/json" -d "{\"policyId\":\"$PID\",\"name\":\"COMP$TS\",\"kind\":\"exam\",\"weight\":10}"); CID=$(mk); c2=$(code -X PATCH "$B/school/assessment-components/$CID" -H "$auth" -H "Content-Type: application/json" -d '{"weight":20}'); c3=$(code -X DELETE "$B/school/assessment-components/$CID" -H "$auth"); echo "assessment-components: C=$c P=$c2 D=$c3"; fi

# Assessment
c=$(code -X POST "$B/school/assessments" -H "$auth" -H "Content-Type: application/json" -d "{\"subjectId\":\"$SUB\",\"classId\":\"$CLASS\",\"termId\":\"$TERM\",\"title\":\"ASM$TS\"}"); AID=$(mk); c2=$(code -X PATCH "$B/school/assessments/$AID" -H "$auth" -H "Content-Type: application/json" -d '{"title":"ASME"}'); c3=$(code -X DELETE "$B/school/assessments/$AID" -H "$auth"); echo "assessments: C=$c P=$c2 D=$c3"

# Roster capture + delete
c=$(code -X POST "$B/school/rosters/capture" -H "$auth" -H "Content-Type: application/json" -d "{\"termId\":\"$TERM\",\"scopeType\":\"grade\",\"name\":\"ROS$TS\"}"); RID=$(mk); c3=$(code -X DELETE "$B/school/rosters/$RID" -H "$auth"); echo "rosters(capture): C=$c D=$c3"

# Rubric
c=$(code -X POST "$B/school/rubrics" -H "$auth" -H "Content-Type: application/json" -d "{\"name\":\"RUB$TS\"}"); RUB=$(mk); c3=$(code -X DELETE "$B/school/rubrics/$RUB" -H "$auth"); echo "rubrics: C=$c D=$c3"

# Exam Type (needs weight)
c=$(code -X POST "$B/school/exam-types" -H "$auth" -H "Content-Type: application/json" -d "{\"name\":\"ET$TS\",\"weight\":1}"); EID=$(mk); c2=$(code -X PATCH "$B/school/exam-types/$EID" -H "$auth" -H "Content-Type: application/json" -d '{"name":"ETE"}'); c3=$(code -X DELETE "$B/school/exam-types/$EID" -H "$auth"); echo "exam-types: C=$c P=$c2 D=$c3"

# Exam (needs termId, examTypeId, classes[], startDate, endDate)
c=$(code -X POST "$B/school/exams" -H "$auth" -H "Content-Type: application/json" -d "{\"termId\":\"$TERM\",\"examTypeId\":\"$ET\",\"name\":\"EX$TS\",\"startDate\":\"2099-03-01\",\"endDate\":\"2099-04-01\",\"classes\":[\"$CLASS\"]}"); XID=$(mk); c2=$(code -X PATCH "$B/school/exams/$XID" -H "$auth" -H "Content-Type: application/json" -d '{"name":"EXE"}'); c3=$(code -X DELETE "$B/school/exams/$XID" -H "$auth"); echo "exams: C=$c P=$c2 D=$c3"

# Exam Schedule (needs examId, classId, subjectId, date, startTime)
c=$(code -X POST "$B/school/exam-schedules" -H "$auth" -H "Content-Type: application/json" -d "{\"examId\":\"$XID\",\"classId\":\"$CLASS\",\"subjectId\":\"$SUB\",\"date\":\"2099-03-15\",\"startTime\":\"09:00\"}"); SID=$(mk); c2=$(code -X PATCH "$B/school/exam-schedules/$SID" -H "$auth" -H "Content-Type: application/json" -d '{"startTime":"10:00"}'); c3=$(code -X DELETE "$B/school/exam-schedules/$SID" -H "$auth"); echo "exam-schedules: C=$c P=$c2 D=$c3"

# Grade Entry (no deletedAt -> hard delete)
if [ -n "$SID" ] && [ -n "$STU" ]; then c=$(code -X POST "$B/school/grades" -H "$auth" -H "Content-Type: application/json" -d "{\"examScheduleId\":\"$SID\",\"studentProfileId\":\"$STU\",\"marksObtained\":50,\"maxMarks\":100}"); GID=$(mk); c2=$(code -X PATCH "$B/school/grades/$GID" -H "$auth" -H "Content-Type: application/json" -d '{"marksObtained":55}'); c3=$(code -X DELETE "$B/school/grades/$GID" -H "$auth"); echo "grades: C=$c P=$c2 D=$c3"; fi

# Grading Scale (needs bands)
c=$(code -X POST "$B/school/grading-scales" -H "$auth" -H "Content-Type: application/json" -d "{\"name\":\"GS$TS\",\"bands\":[{\"min\":0,\"max\":100,\"grade\":\"A\",\"gpa\":4}]}"); GS=$(mk); c2=$(code -X PATCH "$B/school/grading-scales/$GS" -H "$auth" -H "Content-Type: application/json" -d '{"name":"GSE"}'); c3=$(code -X DELETE "$B/school/grading-scales/$GS" -H "$auth"); echo "grading-scales: C=$c P=$c2 D=$c3"

# Competency (uses title)
c=$(code -X POST "$B/school/competencies" -H "$auth" -H "Content-Type: application/json" -d "{\"title\":\"CMP$TS\"}"); CMP=$(mk); c2=$(code -X PATCH "$B/school/competencies/$CMP" -H "$auth" -H "Content-Type: application/json" -d '{"title":"CMPE"}'); c3=$(code -X DELETE "$B/school/competencies/$CMP" -H "$auth"); echo "competencies: C=$c P=$c2 D=$c3"

# Learning Outcome (uses title)
c=$(code -X POST "$B/school/learning-outcomes" -H "$auth" -H "Content-Type: application/json" -d "{\"title\":\"LO$TS\"}"); LO=$(mk); c2=$(code -X PATCH "$B/school/learning-outcomes/$LO" -H "$auth" -H "Content-Type: application/json" -d '{"title":"LOE"}'); c3=$(code -X DELETE "$B/school/learning-outcomes/$LO" -H "$auth"); echo "learning-outcomes: C=$c P=$c2 D=$c3"

# Exam Venue
c=$(code -X POST "$B/school/exam-venues" -H "$auth" -H "Content-Type: application/json" -d "{\"name\":\"VEN$TS\",\"capacity\":30}"); VEN=$(mk); c2=$(code -X PATCH "$B/school/exam-venues/$VEN" -H "$auth" -H "Content-Type: application/json" -d '{"capacity":40}'); c3=$(code -X DELETE "$B/school/exam-venues/$VEN" -H "$auth"); echo "exam-venues: C=$c P=$c2 D=$c3"

# Question Bank (CBT)
c=$(code -X POST "$B/school/question-banks" -H "$auth" -H "Content-Type: application/json" -d "{\"name\":\"QB$TS\"}"); QB=$(mk); c3=$(code -X DELETE "$B/school/question-banks/$QB" -H "$auth"); echo "question-banks: C=$c D=$c3"

# Paper (CBT uses name)
c=$(code -X POST "$B/school/papers" -H "$auth" -H "Content-Type: application/json" -d "{\"name\":\"PAP$TS\"}"); PAP=$(mk); c3=$(code -X DELETE "$B/school/papers/$PAP" -H "$auth"); echo "papers: C=$c D=$c3"

# Report Card (generated, not created)
c=$(code -X POST "$B/school/report-cards/generate" -H "$auth" -H "Content-Type: application/json" -d "{\"studentProfileId\":\"$STU\",\"termId\":\"$TERM\"}"); RC=$(mk); echo "report-cards(generate): C=$c id=$RC"
if [ -n "$RC" ]; then c3=$(code -X DELETE "$B/school/report-cards/$RC" -H "$auth"); echo "report-cards(delete): D=$c3"; fi

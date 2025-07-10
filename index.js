import express from "express";
import fs from "fs";
import pdf from "pdf-parse-new";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import multer from "multer";
import process from "process";

dotenv.config();

// Validate environment variables
if (!process.env.API_KEY) {
    console.error("API_KEY is not set in .env");
    process.exit(1);
}

const app = express();
app.use(cors());

// Configure multer for file uploads
const upload = multer({ dest: "uploads/" });

// Default job description (used if none provided by client)
const defaultJobDesc = `
    Microsoft Azure Storage is a highly distributed, massively scalable, and ubiquitously accessible cloud storage platform. To provide unmatched performance at lowest cost and power, the Azure storage team is building the storage stack that will run on the DPU (Data Processing Units) based storage nodes. We are looking for a Software Engineer who is interested in developing and deploying distributed storage.

    As a Software Engineer, you will have a chance to work on design, implementation, and optimizations of highly performant and massively scale out storage on DPU hardware. You will be involved in all phases of the storage lifecycle, design, implementation, test, deployment, and support. This opportunity will allow you to accelerate your career growth and hone your technical skills.

    Responsibilities:
    - Works with appropriate stakeholders to determine user requirements for the new features to be developed.
    - Participates and contributes to the design of massively scalable storage services.
    - Owns software components and/or modules and drives the component level design decisions working with the team, senior engineers, and architects.
    - Creates and implements code for a product, service, or feature, reusing code as applicable.
    - Writes and learns to create code that is extensible and maintainable.

    Qualifications:
    - Bachelor's Degree in Computer Science, or related technical discipline with proven experience coding in languages including, but not limited to, C, C++, C#, Java, JavaScript, or Python.
    - Knowledge of Windows or Linux Operating System, AND distributed systems and storage.
`;

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Extract text from resume and analyze it
app.post("/extract-text", upload.single("resume"), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error("No resume file uploaded");
        }

        const databuffer = fs.readFileSync(req.file.path);
        const data = await pdf(databuffer);
        const resumeText = data.text;

        // Use provided job description or fallback to default
        const jobDesc = req.body.jobDescription || defaultJobDesc;

        const categorizedData = categorizeResumeText(resumeText);
        const analysis = await generateText(resumeText, jobDesc);

        res.json({
            numPages: data.numpages,
            categories: categorizedData,
            text: resumeText,
            analysis: analysis,
        });

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Categorize resume text with improved regex-based logic
function categorizeResumeText(text) {
    const categories = {
        education: [],
        skills: [],
        experience: [],
        projects: [],
        achievements: [],
        certifications: [],
    };
    const sectionHeaders = {
        education: /\b(education|academic)\b/i,
        skills: /\b(skills|technical skills)\b/i,
        experience: /\b(experience|work experience|employment)\b/i,
        projects: /\b(projects|portfolio)\b/i,
        certifications: /\b(certifications|certified)\b/i,
        achievements: /\b(achievements|awards|honors)\b/i,
    };

    const lines = text.split("\n");
    let currentCategory = null;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue; // Skip empty lines

        // Check if line matches a section header
        for (const [category, regex] of Object.entries(sectionHeaders)) {
            if (regex.test(line)) {
                currentCategory = category;
                categories[currentCategory].push(line);
                break;
            } else if (currentCategory) {
                categories[currentCategory].push(line);
            }
        }
    }
    return categories;
}

// Generate AI analysis of resume against job description
async function generateText(resumeText, jobDesc) {
    try {
        if (!resumeText) {
            throw new Error("Resume text is not provided");
        }
        if (!jobDesc) {
            throw new Error("Job description is not provided");
        }

        const prompt = `
        Analyze the provided resume against the job description for ATS compliance, relevance, and effectiveness. Provide a structured JSON response for visualization.

        *Evaluation Criteria:*
        1. ATS Score (0-100): Relevance (0-40), Keyword Match (0-30), Formatting/Readability (0-20), Contact Completeness (0-10).
        2. Missing Sections: Critical (e.g., Work Experience), Recommended (e.g., Certifications).
        3. Missing Skills: Must-Have and Nice-to-Have from the job description.
        4. Missing Achievements: Suggest quantifiable achievements.
        5. Contact Information Validation: Extract and validate email, LinkedIn, etc.
        6. AI-Powered Suggestions: Detailed feedback in Markdown.

        *Resume:*
        ${resumeText}

        *Job Description:*
        ${jobDesc}

        *JSON Response Format:*
        {
          "ats_score": { "total": 0, "breakdown": { "relevance": 0, "keyword_match": 0, "formatting": 0, "contact_completeness": 0 } },
          "missing_sections": { "critical": [], "recommended": [] },
          "missing_skills": { "must_have": [], "nice_to_have": [] },
          "missing_achievements": [],
          "contact_info": { "email": null, "linkedin": null, "github": null, "portfolio": null },
          "suggestions": []
        }
        `;

        const result = await model.generateContent(prompt);
        let responseText = await result.response.text();

        // Log the raw response for debugging
        // console.log("Raw AI response:", responseText);

        // Clean the response to ensure it is valid JSON
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '');

        // Attempt to parse the response as JSON
        try {
            const parsedResponse = JSON.parse(responseText);
            // console.log("Parsed AI response:", parsedResponse); // Log the parsed response
            return parsedResponse;
        } catch (error) {
            console.error("Failed to parse AI response as JSON:", responseText, error);
            return { rawResponse: responseText, error: "Invalid JSON response from AI" };
        }
    } catch (error) {
        console.error("Error generating content:", error);
        throw error;
    }
}

// Start the server
app.listen(3000, () => {
    console.log("Server is running at port: 3000");
});
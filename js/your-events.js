// Import Firebase modules from your S3 URL
import { auth, onAuthStateChanged, db } from 'https://maclellan-family-website.s3.us-east-2.amazonaws.com/firebase-init.js';

// Import Firestore functions
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js';

// Import necessary functions and tokens 
import { refreshDropboxAccessToken, accessToken } from 'https://maclellan-family-website.s3.us-east-2.amazonaws.com/dropbox-auth.js';


onAuthStateChanged(auth, (user) => {
    if (!user) {
        // No user is signed in, redirect to the sign-in page.
        window.location.href = '/sign-in.html';
    }
    // If a user is signed in, do nothing and allow access to the current page.
});

// Function to get URL parameters
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

const year = getUrlParameter('year');

// Modified getThumbnailBlob to always use 'w64h64' resolution
async function getThumbnailBlob(path) {
    const cacheKey = `${path}`;
    const cache = await caches.open('thumbnails-cache');

    // Check if the image is already in the cache
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
        return await cachedResponse.blob();
    }

    // If not in cache, fetch the image
    try {
        const response = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({
                    path: path,
                    format: 'jpeg',
                    size: 'w64h64' // Always use 'w64h64'
                })
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Clone the response so we can store it in the cache
        const responseClone = response.clone();
        cache.put(cacheKey, responseClone);

        return await response.blob();
    } catch (error) {
        console.error('Error fetching thumbnail:', error);
        return null;
    }
}

// Function to create an object URL for the thumbnail
async function getThumbnail(path) {
    const blob = await getThumbnailBlob(path);
    if (blob) {
        const url = URL.createObjectURL(blob);
        return url;
    } else {
        console.error(`Failed to fetch thumbnail for path ${path}`);
        return null;
    }
}

// Function to get the most recent image from a folder and its thumbnail
async function getMostRecentImageFromFolder(folderPath) {
    try {
        const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: folderPath,
                recursive: false,
                include_media_info: false,
                include_deleted: false,
                include_has_explicit_shared_members: false,
                include_mounted_folders: false,
                limit: 2000
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const imageFiles = data.entries.filter(entry => entry['.tag'] === 'file' && entry.name.match(/\.(jpg|jpeg|png|gif)$/i));
        
        if (imageFiles.length === 0) return null;

        // Sort by client_modified date if available, otherwise use server_modified
        imageFiles.sort((a, b) => {
            const dateA = new Date(a.client_modified || a.server_modified);
            const dateB = new Date(b.client_modified || b.server_modified);
            return dateB - dateA; // Most recent first
        });

        const mostRecentImage = imageFiles[0];

        // Get the thumbnail
        const thumbnailUrl = await getThumbnail(mostRecentImage.path_lower);

        return {
            thumbnailUrl: thumbnailUrl,
            imagePath: mostRecentImage.path_lower
        };
    } catch (error) {
        console.error('Error getting most recent image:', error);
        return null;
    }
}

// Main function to list folders and display images
// Main function to list folders and display images
async function listExactYearFolders(folderPath) {
    if (!year) {
        console.error('No year specified in URL parameters. Use ?year=YYYY in the URL.');
        return;
    }

    try {
        await refreshDropboxAccessToken();

        // Ensure folderPath starts with '/'
        if (!folderPath.startsWith('/')) {
            folderPath = '/' + folderPath;
        }

        console.log(`Searching for '${year}' folder within '${folderPath}'...`);

        // Use files/search_v2 to find the year folder within folderPath
        const searchResponse = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: year,
                options: {
                    path: folderPath,
                    max_results: 1000,
                    file_status: "active",
                    filename_only: true
                },
                match_field_options: {
                    include_highlights: false
                }
            })
        });

        if (!searchResponse.ok) {
            const errorData = await searchResponse.json();
            console.error(`Error from Dropbox API during search:`, errorData);
            throw new Error(`Dropbox API Search Error: ${errorData.error_summary}`);
        }

        const searchData = await searchResponse.json();
        const yearFolderMatches = searchData.matches.filter(match =>
            match.metadata.metadata['.tag'] === 'folder' &&
            match.metadata.metadata.name === year
        );

        if (yearFolderMatches.length === 0) {
            console.error(`No '${year}' folder found within '${folderPath}'.`);
            const eventBentoGrid = document.getElementById('event-bento-grid2');
            const noResultsDiv = document.createElement('div');
            noResultsDiv.textContent = `No '${year}' folder found within '${folderPath}'.`;
            eventBentoGrid.appendChild(noResultsDiv);
            return;
        }

        // Assuming we take the first match
        const yearFolderPath = yearFolderMatches[0].metadata.metadata.path_lower;
        console.log(`Found '${year}' folder at: ${yearFolderPath}`);

        // Now list contents of the year folder
        const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: yearFolderPath,
                recursive: false,
                include_media_info: false,
                include_deleted: false,
                include_has_explicit_shared_members: false,
                include_mounted_folders: false,
                limit: 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error(`Error from Dropbox API during listing:`, errorData);
            throw new Error(`Dropbox API List Error: ${errorData.error_summary}`);
        }

        const data = await response.json();
        const entries = data.entries;

        const eventBentoGrid = document.getElementById('event-bento-grid2');
        if (!eventBentoGrid) {
            console.error('Element with id "event-bento-grid2" not found');
            return;
        }

        if (entries.length > 0) {
            for (const item of entries) {
                if (item['.tag'] === 'folder') {
                    const imageData = await getMostRecentImageFromFolder(item.path_lower);
                    if (imageData && imageData.thumbnailUrl) {
                        // Create an 'a' element
                        const folderLink = document.createElement('a');
                        folderLink.className = 'folder-item';

                        // Set the href attribute to include year and path
                        const encodedPath = encodeURIComponent(item.path_lower);
                        const href = `family-pictures.html?year=${encodeURIComponent(year)}&path=${encodedPath}`;
                        folderLink.href = href;

                        // Create an img element
                        const img = document.createElement('img');
                        img.alt = item.name;
                        img.loading = 'lazy'; // Implement lazy loading

                        // Set the styles for the image
                        img.style.width = '100%';
                        img.style.height = 'auto'; // Auto for height to keep aspect ratio
                        img.style.objectFit = 'cover';
                        img.style.borderRadius = '4px';

                        // Set the src to the thumbnail URL
                        img.src = imageData.thumbnailUrl;

                        // Append the image to the folder link
                        folderLink.appendChild(img);

                        // Optionally, add a caption
                        const caption = document.createElement('p');
                        caption.textContent = item.name;
                        folderLink.appendChild(caption);

                        // Append the folder link to the grid
                        eventBentoGrid.appendChild(folderLink);
                    } else {
                        console.log(`Folder skipped (no images): ${item.path_display}`);
                    }
                }
            }

            // Initialize Isotope after all folder items are added
            const iso = new Isotope(eventBentoGrid, {
                itemSelector: '.folder-item',
                layoutMode: 'masonry',
                percentPosition: true,
                masonry: {
                    columnWidth: '.folder-item',
                    horizontalOrder: true, // Ensure vertical stacking
                    gutter: 10              // Space between items
                }
            });

            // Ensure layout updates once all images are loaded
            imagesLoaded(eventBentoGrid, function () {
                iso.layout();
            });
        } else {
            const noResultsDiv = document.createElement('div');
            noResultsDiv.textContent = `No folders found in '${yearFolderPath}'.`;
            eventBentoGrid.appendChild(noResultsDiv);
        }

        console.log(`Finished listing folders for ${year} in '${yearFolderPath}'.`);

    } catch (error) {
        console.error('Error listing folders:', error);
        console.error('Error details:', error.message);

        const errorDiv = document.createElement('div');
        errorDiv.textContent = `Error: ${error.message}`;
        document.getElementById('event-bento-grid2').appendChild(errorDiv);
    }
}


// Main function to authenticate and initiate folder listing
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const docRef = doc(db, 'users', user.uid); // Adjust collection name if different
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                let folderPath = docSnap.data().folderPath;
                if (!folderPath) {
                    console.error('folderPath is not defined in the user document');
                    return;
                }
                await listExactYearFolders(folderPath);
            } else {
                console.error('No such document!');
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
        }
    } else {
        // User is signed out
        console.error('User is not signed in');
    }
});

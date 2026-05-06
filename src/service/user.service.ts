import { ApolloError } from "apollo-server";
import { CreateUserInput, FindUserByIdInput, LoginInput, UpdateUserInput, User, UserModel, UserRole } from "../schema/user.schema";
import { ClubModel } from "../schema/club.schema";
import Context from "../types/context";
import bcrypt from "bcryptjs"
import { signJwt } from "../utils/jwt";
import { isAdmin } from "../utils/helpers";
import { Validate } from "../utils/validateCheck";
import { logger } from "../utils/logger";

class UserService {
    constructor() {
        // Fix any users with null names on service initialization
        this.fixUsersWithNullNames().catch(error => {
            logger.error('Error fixing users with null names:', error);
        });
    }

    private async fixUsersWithNullNames() {
        try {
            // Find all users with null names
            const usersWithNullNames = await UserModel.find({ 
                $or: [
                    { name: null },
                    { name: { $exists: false } }
                ]
            }).lean();
            
            if (usersWithNullNames.length > 0) {
                logger.warn(`Found ${usersWithNullNames.length} users with null names, fixing...`);
                
                // Update each user with a default name based on their email
                for (const user of usersWithNullNames) {
                    let defaultName: string;
                    
                    if (user.email) {
                        defaultName = user.email.split('@')[0]; // Use part before @ as default name
                    } else {
                        // If no email, use a generic name with timestamp
                        defaultName = `user_${Date.now()}`;
                        logger.warn(`User ${user._id} has no email, using generic name: ${defaultName}`);
                    }

                    try {
                        await UserModel.findByIdAndUpdate(user._id, { 
                            name: defaultName 
                        });
                        logger.info(`Fixed user ${user._id} with name: ${defaultName}`);
                    } catch (updateError) {
                        logger.error(`Failed to update user ${user._id}:`, updateError);
                        // Continue with next user instead of failing completely
                        continue;
                    }
                }
            }
        } catch (error) {
            logger.error('Error in fixUsersWithNullNames:', error);
            // Don't throw the error since this is a maintenance function
            // Just log it and let the application continue running
        }
    }

    async createUser(input: CreateUserInput){
        const emailErr = `User with email: ${input.email} already exits`;
        const passwordErr = 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character (@#$&*-^!).';
        const emailInput = input.email.toLowerCase()

        try {
             // Validate the password using the utility function
                if (!Validate.isValidPassword(input.password)) {
                    throw new ApolloError(passwordErr);
                }
        
            // Check if the user already exists by email
            const existingUser = await UserModel.find().findByEmail(input.email).lean();
            if (existingUser) {
              throw new ApolloError(emailErr);
            }

        
            // Create the user
            const newUser = await UserModel.create({
                ...input,
                email: emailInput
            });

            return newUser;
          } catch (error) {
            // Catch any error that occurs in the try block and handle it
            if (error instanceof ApolloError) {
              // If the error is already an ApolloError, just throw it
              throw error;
            }
            
            // If the error is something else (e.g. validation or database error), log and rethrow
            logger.error('Error creating user:', error);
            throw new ApolloError('An unexpected error occurred while creating the user');
          }
    }
    async createClub(input: CreateUserInput): Promise<User>{
        const emailErr = `Club with email: ${input.email} already exits`;
        const passwordErr = 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character (@#$&*-^!).';
        const emailInput = input.email.toLowerCase()

        try {
             // Validate the password using the utility function
                if (!Validate.isValidPassword(input.password)) {
                    throw new ApolloError(passwordErr);
                }
        
            // Check if the user already exists by email
            const existingClub = await UserModel.find().findByEmail(input.email).lean();
            if (existingClub) {
              throw new ApolloError(emailErr);
            }

        
            // Create the Club
            const newClub = await UserModel.create({
                ...input,
                email: emailInput,
                role: UserRole.CLUB
            });

            return newClub;
          } catch (error) {
            // Catch any error that occurs in the try block and handle it
            if (error instanceof ApolloError) {
              // If the error is already an ApolloError, just throw it
              throw error;
            }
            
            // If the error is something else (e.g. validation or database error), log and rethrow
            logger.error('Error creating club:', error);
            throw new ApolloError('An unexpected error occurred while creating the club');
          }
    }

    async login(input: LoginInput, context: Context){
        const errorEmail = "Invalid email or password";
        const emailInput = input.email.trim();
        const passwordInput = input.password.trim();
        // await rateLimiter(30, 3, 'LOGIN', emailInput)(null, { email: input.email }, context, null);

        // Get user by email 
        const user =  await UserModel.findOne({email: emailInput}).lean();

        if(!user){
            throw new ApolloError(errorEmail)
        }

        // validate the password 

        // Some legacy records may use "$2y$" bcrypt prefix; normalize for compare compatibility.
        const normalizedStoredHash = user.password.startsWith("$2y$")
          ? user.password.replace("$2y$", "$2b$")
          : user.password;
        const passwordIsValid = await bcrypt.compare(passwordInput, normalizedStoredHash)
        if(!passwordIsValid){
            throw new ApolloError(errorEmail)
        }
        
        const isProduction = process.env.NODE_ENV === "production";
        const rememberMeMaxAge = input.rememberMe ? 7 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000; // 7 days for both remember me and regular sessions
        
        const trimmedUser = {
            _id: user?._id,
            name: user?.name,
			email: user?.email,
			role: user?.role,
			
		}

        // sign a jwt 
        const token = signJwt(trimmedUser)

        // set a cookie for the jwt
        context.res.cookie("accessToken", token, {
            maxAge: rememberMeMaxAge,
            httpOnly: true,
            path: "/",
            sameSite: isProduction ? "none" : "lax",
            secure: isProduction,
        });

        // Also set a non-httpOnly cookie for client-side access as fallback
        // This helps with Safari and incognito mode compatibility
        context.res.cookie("authToken", token, {
            maxAge: rememberMeMaxAge,
            httpOnly: false,
            path: "/",
            sameSite: isProduction ? "none" : "lax",
            secure: isProduction,
        });

        // Set user role cookie for client-side role checking
        context.res.cookie("userRole", trimmedUser.role, {
            maxAge: rememberMeMaxAge,
            httpOnly: false,
            path: "/",
            sameSite: isProduction ? "none" : "lax",
            secure: isProduction,
        });

        // Return user data with token for header-based auth fallback
        return {
            ...trimmedUser,
            token: token
        };
    }

    async findUserById(input: FindUserByIdInput, currentUser: User | undefined) {
        const e = " User with the given Id does not exist";
        
        // Allow access to user details even if user is not logged in
        let user = await UserModel.findById(input._id).lean();
        if (!user) {
            return new ApolloError(e);
        }
        return user;
    }

    async findClubById(input: FindUserByIdInput, currentUser: User | undefined) {
        const e = " Club with the given Id does not exist";
        
        // Allow access to club details even if user is not logged in
        let club = await UserModel.findById(input._id).lean();
        if (!club) {
            throw new ApolloError(e);
        }

        if (club.role !== UserRole.CLUB) {
            throw new ApolloError("Unauthorized");
        }
        return club;
    }

    async getAllUsers(user: User | undefined) {
        try {
            // If the user is not authenticated, return a limited set of user data
            if (!user) {
                console.log("Unauthenticated user - returning limited user data");
                const users = await UserModel.find({}, '_id name email role').lean();
                return users.filter(u => u.name != null);
            }

            // Check if the user's role is 'admin'
            const isAdmin = user.role === 'ADMIN';

            // If the user is not an admin but is a club, return filtered data
            if (user.role === 'CLUB') {
                const users = await UserModel.find({}, '_id name email role').lean();
                return users.filter(u => u.name != null);
            }

            // If the user is not an admin or club, throw an error
            if (!isAdmin) {
                throw new ApolloError('Unauthorized: Only admin can access full user data');
            }

            const users = await UserModel.find().lean();
            return users.filter(u => u.name != null);
        } catch (error) {
            logger.error('Error in getAllUsers:', error);
            if (error instanceof ApolloError) {
                throw error;
            }
            throw new ApolloError('Failed to fetch users');
        }
    }

    async getAllClubs(user: User | undefined): Promise<User[]> {
        try {
            // Return all clubs for all users, authenticated or not
            console.log("UserService: Returning all clubs - public access");
            const clubs = await UserModel.find({ role: 'CLUB' })
                .sort({ createdAt: -1 })
                .lean();
            
            console.log(`UserService: Found ${clubs.length} clubs`);
            return clubs;
        } catch (error) {
            console.error("Error in UserService.getAllClubs:", error);
            throw error;
        }
    }

    async updateUserProfile(
		input: UpdateUserInput & { user: User["_id"] },
		userInformation: User
	): Promise<User> {
		// Keep a copy of the original values so we can sync the `clubs` collection
		const originalUser = await UserModel.findById(input?.user).lean();

		if (userInformation?.email !== input?.email && input?.email) {
			//email change attemp
			const userWithEmailExist = await UserModel.find({
				email: input?.email,
			}).lean();

			if (userWithEmailExist?.length) {
				throw new ApolloError(
					`User with email ${input.email} exist, kindly use another email!`
				);
			}
		}

		const user = await UserModel.findOneAndUpdate(
			{ _id: input?.user },
			{
				$set: input,
			},
			{ new: true }
		).lean();

		// Synchronize with `clubs` collection when applicable
		try {
			if (originalUser) {
				const clubUpdate: Record<string, unknown> = {};
				if (typeof input?.name === "string") clubUpdate["clubName"] = input.name;
				if (typeof input?.email === "string") clubUpdate["email"] = input.email;

				if (Object.keys(clubUpdate).length > 0) {
					await ClubModel.findOneAndUpdate(
						{ email: originalUser.email },
						{ $set: clubUpdate },
						{ new: true }
					).lean();
				}
			}
		} catch (syncError) {
			// Do not fail the main update if club sync fails
			logger.error("Failed to sync club document with user profile update:", syncError);
		}

		if (user) {
			return user;
		} else {
			throw new ApolloError("update failed");
		}
	}
    async updateClub(
		input: UpdateUserInput,
		userInformation: User,
        clubId: String
	): Promise<User> {
        const passwordErr = 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character (@#$&*-^!).';

        if(userInformation.role !== UserRole.ADMIN){
            throw new ApolloError("UnAuthorized to update this club")
        }

        if (input.password) {
            if (!Validate.isValidPassword(input.password)) {
                throw new ApolloError(passwordErr);
            }

            // Hash the new password
            const salt = await bcrypt.genSalt(10);
            input.password = await bcrypt.hash(input.password, salt);
        }

        if(input.email){
            if(!Validate.isValidEmail(input.email)){
                throw new ApolloError('Email is not valid')
            }
        }

		// Keep a copy of the original values for locating the club doc
		const originalUser = await UserModel.findById(clubId).lean();

		const user = await UserModel.findOneAndUpdate(
			{ _id: clubId },
			{
				$set: input,
			},
			{ new: true }
		).lean();

		// Mirror the change in the `clubs` collection
		try {
			if (originalUser) {
				const clubUpdate: Record<string, unknown> = {};
				if (typeof input?.name === "string") clubUpdate["clubName"] = input.name;
				if (typeof input?.email === "string") clubUpdate["email"] = input.email;
				if (typeof input?.password === "string") clubUpdate["password"] = input.password; // already hashed above if provided

				if (Object.keys(clubUpdate).length > 0) {
					// Prefer matching by the previous email to handle email changes
					const filter = originalUser.email
						? { email: originalUser.email }
						: { email: user?.email };

					await ClubModel.findOneAndUpdate(
						filter,
						{ $set: clubUpdate },
						{ new: true }
					).lean();
				}
			}
		} catch (syncError) {
			logger.error("Failed to sync club document with admin club update:", syncError);
		}

		if (user) {
			return user;
		} else {
			throw new ApolloError("update failed");
		}
	}

    async deleteUser(userId: String, user: User){
		const e = " User with the given Id does not exist";
		const initialUser = await UserModel.findById(userId).lean();
		if (!initialUser) {
			throw new ApolloError(e);
		}

        const isAdmin = user.role === 'ADMIN';
        
		if (!isAdmin) {
			throw new ApolloError('Unauthorized: Only admin can delete this user');
		}
		const deletedUser = await UserModel.findByIdAndDelete(initialUser._id).lean();

		return deletedUser;
	}
    async deleteClub(userId: String,  user: User){
		const e = " Club with the given Id does not exist";
		const club = await UserModel.findById(userId).lean();
		if (!club) {
			throw new ApolloError(e);
		}

        const isAdmin = user.role === 'ADMIN';
        
		if (!isAdmin) {
			throw new ApolloError('Unauthorized: Only admin can delete this Club');
		}
		const deletedClub = await UserModel.findByIdAndDelete(club._id).lean();

		return deletedClub
	}

    async getAdminUsers(): Promise<User[]> {
        try {
            console.log("Fetching admin users...");
            const admins = await UserModel.find({ role: UserRole.ADMIN }).lean();
            console.log("Found admin users:", admins.map(admin => ({
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role
            })));
            return admins;
        } catch (error) {
            console.error("Error fetching admin users:", error);
            throw new ApolloError("Failed to retrieve admin users");
        }
    }
}

export default UserService;
import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from "type-graphql";
import Context from "../types/context";
import { YearbookService } from "../service/yearbook.service";
import {
  CreateYearbookInput,
  FindYearbookByIdInput,
  UpdateYearbookInput,
  Yearbook,
} from "../schema/yearbook.schema";
import { ApolloError } from "apollo-server";
import uploadFile from "../utils/s3Upload";
import {
  YEARBOOK_MAX_FILE_SIZE_BYTES,
  YEARBOOK_MAX_FILE_SIZE_MB,
} from "../config/upload";

function validateYearbookFileSize(base64DataUri: string) {
  const base64Payload = base64DataUri.split(",")[1];

  if (!base64Payload) {
    throw new ApolloError("Invalid yearbook file format");
  }

  const fileSizeInBytes = Buffer.byteLength(base64Payload, "base64");
  if (fileSizeInBytes > YEARBOOK_MAX_FILE_SIZE_BYTES) {
    throw new ApolloError(
      `Yearbook file exceeds ${YEARBOOK_MAX_FILE_SIZE_MB}MB limit`
    );
  }
}

@Resolver()
export default class YearbookResolver {
  constructor(private yearbookService: YearbookService) {
    this.yearbookService = new YearbookService();
  }

  @Authorized()
  @Mutation(() => Yearbook) // Assuming Yearbook is the return type
  async createYearbook(
    @Ctx() context: Context,
    @Arg("input") input: CreateYearbookInput
  ) {
    try {
      const { yearbook, yearbookName, yearPublish } = input;
      const user = context.user!;

      // Check if there is a file to upload
      let uploadedFileUrl = null;
      if (yearbook) {
        validateYearbookFileSize(yearbook);
        // If the file is provided, we assume the file is a base64-encoded string
        uploadedFileUrl = await uploadFile(
          yearbook,
          user._id,
          "uploads/yearbook/"
        );
        if (!uploadedFileUrl) {
          throw new ApolloError("Error uploading the file.");
        }
      }
      // Now we add the uploaded file URL (if any) to the input data
      const yearbookData = {
        yearPublish,
        yearbookName,
        yearbook: uploadedFileUrl as string,
      };

      // Call the Yearbook service to create the yearbook
      return await this.yearbookService.createYearbook(yearbookData, user);
    } catch (error) {
      console.error(error);
      throw new ApolloError("An Unexpected Error Occurred");
    }
  }

  @Query(() => [Yearbook])
  async getAllYearbooks(@Ctx() context: Context) {
    const user = context.user || null;
    return await this.yearbookService.getAllYearbooks(user);
  }

  @Query(() => Yearbook, { nullable: true })
  async findYearbookById(
    @Arg("input") input: FindYearbookByIdInput,
    @Ctx() context: Context
  ) {
    const user = context.user || null;
    const yearbook = await this.yearbookService.findYearbookById(input, user);

    return yearbook;
  }

  @Authorized()
  @Mutation(() => Yearbook)
  async updateYearbook(
    @Ctx() context: Context,
    @Arg("input") input: UpdateYearbookInput,
    @Arg("yearbookId") yearbookId: String
  ) {
    try {
      const user = context.user!;
      const { yearbook, yearbookName, yearPublish } = input;
      if (!user) {
        throw new ApolloError("Unauthorized: User is not authenticated");
      }

      // Check if there is a file to upload
      let uploadedFileUrl = null;
      if (yearbook) {
        validateYearbookFileSize(yearbook);
        // If the file is provided, we assume the file is a base64-encoded string
        uploadedFileUrl = await uploadFile(
          yearbook,
          user._id,
          "uploads/yearbook/"
        );
        if (!uploadedFileUrl) {
          throw new ApolloError("Error uploading the file.");
        }
      }
      // Now we add the uploaded file URL (if any) to the input data
      const yearbookData = {
        yearPublish,
        yearbookName,
        yearbook: uploadedFileUrl as string,
      };

      return await this.yearbookService.updateYearbook(
        yearbookData,
        user,
        yearbookId
      );
    } catch (error) {
      console.error(error);
      throw new ApolloError("An Unexpected Error Occurred");
    }
  }

  @Authorized()
  @Mutation(() => Yearbook)
  async deleteYearbook(
    @Ctx() context: Context,
    @Arg("yearbookId") yearbookId: String
  ) {
    const user = context.user;
    if (!user) {
      throw new ApolloError("Unauthorized: User is not authenticated");
    }

    return await this.yearbookService.deleteYearbook(user, yearbookId);
  }
}
